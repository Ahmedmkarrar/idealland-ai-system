import { prisma } from "@/lib/db/client";
import { sendPlanningAlert } from "@/lib/services/email";
import { sendTelegramAlert } from "@/lib/services/telegram";
import { autoSendApplicationAlert } from "@/lib/services/mailing";
import { cleanCouncilUrl, planIndexUrl, verifyMirrorUrl } from "@/lib/planning-portals";
import { withRetry } from "@/lib/retry";

// IdealLand's target band: 1-9 residential units. At 10+ units a scheme
// triggers affordable-housing obligations (s.106 / borough policy) that
// developers want to avoid, so the sweet spot is genuine small residential
// development that sits BELOW that threshold. Tunable via env if policy or
// the client's appetite changes.
const MIN_UNITS = Number(process.env.PLANNING_MIN_UNITS ?? 1);
const MAX_UNITS = Number(process.env.PLANNING_MAX_UNITS ?? 9);

// How far back (by last-updated) a live scan looks. Dedup on `reference` means
// re-scanning the same window every cron run is safe — only genuinely new
// references are inserted, so this doubles as a rolling backfill window.
const LIVE_WINDOW_DAYS = Number(process.env.PLANNING_SCAN_WINDOW_DAYS ?? 7);

// Hard cap on how many freshly-found apps fire outbound alerts in a single run,
// so a wide window (e.g. the first populate) can't blast Telegram / the mailing
// list. Every new row is still marked alertSent so it never re-alerts later.
const MAX_ALERTS_PER_RUN = Number(process.env.PLANNING_MAX_ALERTS ?? 20);

// External auto-outreach to the developer mailing list is OFF by default — it
// emails real contacts. Set PLANNING_AUTO_OUTREACH=true to enable once the
// contact list and copy have been reviewed. Internal Telegram/email alerts are
// always on (they only reach the IdealLand team).
const AUTO_OUTREACH_ENABLED = process.env.PLANNING_AUTO_OUTREACH === "true";

// ---------------------------------------------------------------------------
// DATA SOURCE — Planning London DataHub (GLA), PRIMARY + ONLY.
//
// Free guest ElasticSearch API; a real-time feed of planning applications for
// ALL 33 London planning authorities, updated daily by back-office connectors.
//
// This replaces two dead sources:
//   1. planning.data.gov.uk — its `planning-application` dataset silently
//      narrowed to a single non-London authority (Doncaster, org-entity 109)
//      with stale mid-2025 data, so every London org-entity filter was ignored
//      and returned all-decided history → 0 live leads for weeks.
//   2. Direct Idox/Northgate council scrapes — Cloudflare-blocks the droplet IP.
//
// Docs: https://www.london.gov.uk/programmes-strategies/planning/digital-planning/planning-london-datahub
// ---------------------------------------------------------------------------
const PLD_BASE_URL = "https://planningdata.london.gov.uk";
const PLD_SEARCH_URL = `${PLD_BASE_URL}/api-guest/applications/_search`;
const PLD_PAGE_SIZE = 250;
const PLD_MAX_RECORDS = Number(process.env.PLANNING_MAX_RECORDS ?? 2000);
const PLD_PROPOSED_UNITS_FIELD =
  "application_details.residential_details.total_no_proposed_residential_units";

interface ScrapedApplication {
  reference: string; // globally-unique PLD document id, e.g. "Camden-2026_2199_P"
  lpaReference?: string; // the council's own ref, e.g. "26/01804/FUL"
  council: string;
  address: string;
  description: string;
  units: number; // structured proposed residential unit count from PLD
  submittedAt: Date;
  applicant?: string;
  councilUrl?: string;
  decidedAt?: Date;
  decision?: string; // "Approved" | "Refused" | "Withdrawn" | ...
}

interface PldSource {
  id?: string;
  lpa_app_no?: string;
  borough?: string;
  lpa_name?: string;
  description?: string;
  decision?: string | null;
  decision_date?: string | null;
  status?: string | null;
  valid_date?: string | null;
  last_updated?: string | null;
  site_name?: string | null;
  site_number?: string | number | null;
  street_name?: string | null;
  secondary_street_name?: string | null;
  postcode?: string | null;
  url_planning_app?: string | null;
  application_details?: {
    lead_developer_company_name?: string | null;
    residential_details?: {
      total_no_proposed_residential_units?: number | null;
      total_no_existing_residential_units?: number | null;
    } | null;
  } | null;
}

// PLD dates come as dd/mm/yyyy (valid_date, decision_date) or ISO
// (last_updated). Returns undefined on anything unparseable so the caller can
// fall back to another field.
function parseUkDate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const uk = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (uk) {
    const d = new Date(Number(uk[3]), Number(uk[2]) - 1, Number(uk[1]));
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const iso = new Date(value);
  return Number.isNaN(iso.getTime()) ? undefined : iso;
}

// PLD stores free-text fields (description, street names) HTML-encoded — e.g.
// "Change&nbsp;of use", "flats&amp;offices". Decode the handful of entities that
// actually appear so both the dashboard and the Claude scoring/outreach prompts
// see clean prose. Also collapse the non-breaking spaces left behind.
const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
  "&quot;": '"', "&apos;": "'", "&#39;": "'", "&#38;": "&",
};
function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&apos;|&#39;|&#38;/g, (m) => HTML_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

// Council name from the PLD document id prefix ("Tower_Hamlets-PA_21..." →
// "Tower Hamlets"). The `borough` field is inconsistent across boroughs (e.g.
// "Enfield" vs "Enfield Council", "LB Bromley" vs "Bromley Custodian Code"), so
// the id prefix is the reliable identifier; borough is a last resort.
function councilFromId(id?: string, borough?: string): string {
  if (id && id.includes("-")) {
    const prefix = id.slice(0, id.indexOf("-")).replace(/_/g, " ").trim();
    if (prefix) return prefix;
  }
  return (borough ?? "London").trim();
}

// PLD's url_planning_app is a path relative to the datahub host (e.g.
// "/planning/index.html?fa=getApplication&id=72883"). Make it absolute so it's
// a clickable landing page for the agent research; leave absolute URLs as-is.
function absolutePldUrl(url?: string | null): string | undefined {
  const u = url?.trim();
  // Reject empties and PLD placeholder junk like "<enter PA URL here>".
  if (!u || u.includes("<") || u.includes(">")) return undefined;
  // Relative paths hang off the datahub; absolute ones are the council's own
  // page. Either way cleanCouncilUrl has the final say, so placeholder domains
  // some councils leave in the feed ("http://site.com/?appref=...") never reach
  // the dashboard as a dead link.
  const absolute = /^https?:\/\//i.test(u)
    ? u
    : u.startsWith("/")
      ? `${PLD_BASE_URL}${u}`
      : null;
  return cleanCouncilUrl(absolute) ?? undefined;
}

// A verified link to the PlanIndex register, for boroughs that publish no link of
// their own. Never stored unverified — see lib/planning-portals.ts.
async function resolveMirrorUrl(
  council: string,
  lpaReference?: string | null
): Promise<string | null> {
  if (!lpaReference) return null;
  const candidate = planIndexUrl(council, lpaReference);
  return candidate ? await verifyMirrorUrl(candidate) : null;
}

function buildAddress(s: PldSource): string {
  const parts = [s.site_number, s.street_name, s.secondary_street_name, s.postcode]
    .map((p) => (p === null || p === undefined ? "" : decodeEntities(String(p))))
    .filter((p) => p.length > 0);
  if (parts.length > 0) return parts.join(", ");

  // Boroughs populate location two different ways. Some fill the structured
  // fields above; the rest put the whole address in `site_name` as one carriage-
  // return-separated string ("51 Streatham Hill\rLondon\rLambeth\rSW2 4TS").
  // Reading only the structured fields left about a third of all leads showing
  // "Croydon (ref 26/00603/CONR)" — no use to anyone trying to look at the site.
  // Split on the line breaks BEFORE decoding — decodeEntities collapses all
  // whitespace, which would turn the separators into spaces and lose the commas.
  if (s.site_name) {
    const lines = String(s.site_name)
      .split(/[\r\n]+/)
      .map((line) => decodeEntities(line).replace(/,$/, "").trim())
      .filter((line) => line.length > 0);
    if (lines.length > 0) return lines.join(", ");
  }

  return `${councilFromId(s.id, s.borough)} (ref ${s.lpa_app_no ?? s.id ?? "unknown"})`;
}

// Query PLD for residential schemes in the 1-9 unit band across all of London,
// paginating by last-updated. `includeDecided:false` (default) returns live
// opportunities (no decision yet); `true` returns decided applications for the
// historical research backfill.
async function fetchFromPLD(opts?: {
  includeDecided?: boolean;
  windowDays?: number;
}): Promise<ScrapedApplication[]> {
  const windowDays = opts?.windowDays ?? LIVE_WINDOW_DAYS;
  const includeDecided = opts?.includeDecided ?? false;

  // A decided application has a non-null `decision` (Approved/Refused/etc.).
  // decision_date is unreliable (often null even when decided), so we key off
  // the `decision` field's existence.
  const decisionClause = includeDecided
    ? { must: [{ exists: { field: "decision" } }] }
    : { must_not: [{ exists: { field: "decision" } }] };

  const filter = [
    { range: { [PLD_PROPOSED_UNITS_FIELD]: { gte: MIN_UNITS, lte: MAX_UNITS } } },
    { range: { last_updated: { gte: `now-${windowDays}d/d` } } },
  ];

  const sourceFields = [
    "id", "lpa_app_no", "borough", "lpa_name", "description",
    "decision", "decision_date", "status", "valid_date", "last_updated",
    "site_name", "site_number", "street_name", "secondary_street_name", "postcode",
    "url_planning_app",
    "application_details.lead_developer_company_name",
    PLD_PROPOSED_UNITS_FIELD,
    "application_details.residential_details.total_no_existing_residential_units",
  ];

  const out: ScrapedApplication[] = [];
  const seen = new Set<string>();

  for (let from = 0; from < PLD_MAX_RECORDS; from += PLD_PAGE_SIZE) {
    const body = JSON.stringify({
      size: PLD_PAGE_SIZE,
      from,
      sort: [{ last_updated: { order: "desc" } }],
      _source: sourceFields,
      query: { bool: { filter, ...decisionClause } },
    });

    let hits: Array<{ _source?: PldSource }> = [];
    try {
      const res = await withRetry(() =>
        fetch(PLD_SEARCH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body,
          signal: AbortSignal.timeout(25000),
        })
      );
      if (!res.ok) break;
      const data = (await res.json()) as {
        hits?: { hits?: Array<{ _source?: PldSource }> };
      };
      hits = data.hits?.hits ?? [];
    } catch {
      break;
    }

    if (hits.length === 0) break;

    for (const hit of hits) {
      const s = hit._source ?? {};
      const units =
        s.application_details?.residential_details
          ?.total_no_proposed_residential_units;
      if (units === null || units === undefined) continue;
      if (units < MIN_UNITS || units > MAX_UNITS) continue;

      const reference = s.id ?? s.lpa_app_no;
      if (!reference || !s.description || seen.has(reference)) continue;
      seen.add(reference);

      out.push({
        reference,
        // Present on every PLD record, unlike url_planning_app — this is what
        // reaches the application when the feed gives us no link.
        lpaReference: s.lpa_app_no?.trim() || undefined,
        council: councilFromId(s.id, s.borough),
        address: buildAddress(s),
        description: decodeEntities(s.description),
        units,
        submittedAt:
          parseUkDate(s.valid_date) ?? parseUkDate(s.last_updated) ?? new Date(),
        applicant: s.application_details?.lead_developer_company_name ?? undefined,
        councilUrl: absolutePldUrl(s.url_planning_app),
        decision: includeDecided ? s.decision?.trim() || undefined : undefined,
        decidedAt: includeDecided
          ? parseUkDate(s.decision_date) ?? parseUkDate(s.last_updated)
          : undefined,
      });
    }

    if (hits.length < PLD_PAGE_SIZE) break;
  }

  return out;
}

// Common "tiny" application keywords — a backstop against domestic extensions
// that slip through with a non-zero unit count (e.g. a granny-annexe counted as
// +1). PLD's structured unit filter already excludes most 0-unit extensions.
const TINY_APPLICATION_PATTERNS = [
  /\b(rear|front|side|loft|garage|porch|outbuilding|conservatory|garden\s+room|shed|fence|tree)\s+(extension|conversion|alteration|works?)/i,
  /\bsingle\s+(storey|story)\s+(rear|front|side|infill)\s+extension/i,
  /\binternal\s+alterations?\b/i,
];

function looksLikeTinyApplication(description: string): boolean {
  return TINY_APPLICATION_PATTERNS.some((p) => p.test(description));
}

// Qualifies an application as an IdealLand target: a genuine residential scheme
// in the 1-9 unit band, and not an obvious domestic extension.
function qualifies(app: ScrapedApplication): boolean {
  if (app.units < MIN_UNITS || app.units > MAX_UNITS) return false;
  if (looksLikeTinyApplication(app.description)) return false;
  return true;
}

export async function scanCouncils(opts?: {
  silent?: boolean;
  windowDays?: number;
}): Promise<{
  found: number;
  alerted: number;
  // Boroughs that returned at least one qualifying scheme — NOT a coverage
  // figure. The DataHub is queried London-wide in one request, so a low number
  // here means a quiet window, not a partial scan.
  boroughsWithMatches: number;
}> {
  const runRecord = await prisma.automationRun.create({
    data: { type: "sourcing", status: "running" },
  });

  try {
    const windowDays = opts?.windowDays ?? LIVE_WINDOW_DAYS;
    const scraped = await fetchFromPLD({ windowDays });
    const relevant = scraped.filter(qualifies);
    const councilsSeen = new Set(relevant.map((a) => a.council));

    const newApplications: Array<{
      id: string;
      reference: string;
      council: string;
      address: string;
      description: string;
      units: number;
      submittedAt: Date;
      councilUrl: string | null;
    }> = [];

    for (const app of relevant) {
      const existing = await prisma.planningApplication.findUnique({
        where: { reference: app.reference },
      });
      if (existing) continue;

      const created = await prisma.planningApplication.create({
        data: {
          reference: app.reference,
          address: app.address,
          description: app.description,
          council: app.council,
          units: app.units,
          status: "submitted",
          applicant: app.applicant ?? null,
          councilUrl: app.councilUrl ?? null,
          lpaReference: app.lpaReference ?? null,
          // Only when the council gives us nothing of its own, and only after the
          // page is confirmed to exist — roughly 18 new leads a day, so a handful
          // of HEAD requests per scan.
          mirrorUrl: app.councilUrl
            ? null
            : await resolveMirrorUrl(app.council, app.lpaReference),
          submittedAt: app.submittedAt,
          alertSent: false,
        },
      });

      newApplications.push(created);
    }

    let alerted = 0;

    if (newApplications.length > 0) {
      // Mark every new row alerted up-front so a later run never re-alerts it —
      // including the ones we intentionally cap out of this run's outbound.
      await prisma.planningApplication.updateMany({
        where: { id: { in: newApplications.map((a) => a.id) } },
        data: { alertSent: true },
      });

      if (!opts?.silent) {
        const freshest = [...newApplications]
          .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
          .slice(0, MAX_ALERTS_PER_RUN);
        alerted = freshest.length;

        const alertPayload = freshest.map((a) => ({
          reference: a.reference,
          address: a.address,
          council: a.council,
          units: a.units,
          description: a.description,
          submittedAt: a.submittedAt,
        }));

        // Internal channels (Telegram + email to the IdealLand team) always
        // fire; external outreach to the developer mailing list is gated behind
        // PLANNING_AUTO_OUTREACH so a wide scan can't spam real contacts. Each
        // no-ops gracefully if its channel isn't configured.
        const channels: Array<Promise<unknown>> = [
          sendTelegramAlert(alertPayload),
          sendPlanningAlert(alertPayload),
        ];
        if (AUTO_OUTREACH_ENABLED) {
          channels.push(autoSendApplicationAlert(alertPayload));
        }
        await Promise.allSettled(channels);
      }
    }

    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        summary: `Scanned Planning London DataHub (last ${windowDays}d, ${councilsSeen.size} boroughs with matches). Found ${newApplications.length} new ${MIN_UNITS}-${MAX_UNITS} unit applications${
          opts?.silent ? " (silent backfill)" : `, alerted ${alerted}`
        }.`,
      },
    });

    return {
      found: newApplications.length,
      alerted,
      boroughsWithMatches: councilsSeen.size,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: { status: "failed", completedAt: new Date(), error: message },
    });
    throw error;
  }
}

// Historical backfill: pull DECIDED applications (approved/refused) from the
// last `lookbackDays` across London, in the same 1-9 unit band. Unlike
// scanCouncils this is a one-shot research tool — it stores decided records for
// James to review past decisions and does NOT fire any alerts/emails. Records
// are marked status "decided" with their decision date; existing references are
// skipped so it's safe to re-run.
export async function scanHistoricalDecisions(lookbackDays = 365): Promise<{
  found: number;
  // See scanCouncils — boroughs with matches, not a coverage figure.
  boroughsWithMatches: number;
  lookbackDays: number;
}> {
  const runRecord = await prisma.automationRun.create({
    data: { type: "decisions-backfill", status: "running" },
  });

  try {
    const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const scraped = await fetchFromPLD({
      includeDecided: true,
      windowDays: lookbackDays,
    });
    const relevant = scraped.filter(
      (app) => qualifies(app) && app.decidedAt && app.decidedAt >= cutoff
    );

    let found = 0;
    const councilsSeen = new Set<string>();

    for (const app of relevant) {
      councilsSeen.add(app.council);
      const existing = await prisma.planningApplication.findUnique({
        where: { reference: app.reference },
      });
      if (existing) continue;

      await prisma.planningApplication.create({
        data: {
          reference: app.reference,
          address: app.address,
          description: app.description,
          council: app.council,
          units: app.units,
          status: "decided",
          applicant: app.applicant ?? null,
          councilUrl: app.councilUrl ?? null,
          lpaReference: app.lpaReference ?? null,
          submittedAt: app.submittedAt,
          decidedAt: app.decidedAt,
          decision: app.decision ?? null,
          // Suppress all outreach — this is historical research, not a live lead.
          alertSent: true,
          decisionAlertSent: true,
        },
      });
      found++;
    }

    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        summary: `Backfilled ${found} decided ${MIN_UNITS}-${MAX_UNITS} unit applications from the last ${lookbackDays} days across ${councilsSeen.size} boroughs (Planning London DataHub).`,
      },
    });

    return { found, boroughsWithMatches: councilsSeen.size, lookbackDays };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: { status: "failed", completedAt: new Date(), error: message },
    });
    throw error;
  }
}

export async function getApplications(filters?: {
  status?: string;
  council?: string;
  minUnits?: number;
}) {
  return prisma.planningApplication.findMany({
    where: {
      ...(filters?.status && { status: filters.status }),
      ...(filters?.council && { council: filters.council }),
      ...(filters?.minUnits && { units: { gte: filters.minUnits } }),
    },
    orderBy: { submittedAt: "desc" },
    include: { documents: true },
  });
}
