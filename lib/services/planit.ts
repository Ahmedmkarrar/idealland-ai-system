// Surrey sourcing — Elmbridge, Epsom & Ewell, Guildford, Mole Valley, Reigate & Banstead.
//
// The London DataHub only covers the 33 London authorities, so Lucy's five Surrey
// districts need a second feed. PlanIt (planit.org.uk) scrapes every UK council's
// register into one free JSON API, and for these five it carries what the London
// feed never did: the agent's practice, and often their phone number.
//
// What it does NOT carry is a clean unit count. London's feed has a structured
// "proposed residential units" field; here there is only the description ("Demolition
// of existing bungalow and erection of 4 no. dwellings"). Regex gets that wrong in
// ways that matter — "a three-bedroom dwelling" is one home, not three — so a
// residential-looking shortlist is sent to Claude to read the net number of new
// homes, and only 1-9 go in.
//
// PlanIt is a free service run by one person and it rate-limits hard (a burst of
// test queries earned a temporary block). So this runs once a day, two small
// queries per district, spaced out, and gives up on a district for the day rather
// than retrying into a limit.

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/client";
import { withRetry } from "@/lib/retry";
import { COVERAGE_AREAS, type CoverageArea } from "@/lib/coverage";
import { cleanCouncilUrl } from "@/lib/planning-portals";
import { publicOwnerReason } from "@/lib/public-ownership";
import { firmFromText, cleanAgentName } from "@/lib/services/portal-extract";

const PLANIT_URL = "https://www.planit.org.uk/api/applics/json";
const MIN_UNITS = Number(process.env.PLANNING_MIN_UNITS ?? 1);
const MAX_UNITS = Number(process.env.PLANNING_MAX_UNITS ?? 9);

/** Gap between PlanIt requests. Generous on purpose — see the header. */
const PLANIT_GAP_MS = Number(process.env.PLANIT_GAP_MS ?? 20000);
/** The daily scan is skipped if one completed more recently than this. */
const MIN_HOURS_BETWEEN_SCANS = Number(process.env.PLANIT_MIN_HOURS ?? 20);
const RUN_TYPE = "sourcing-surrey";

// Full-text search PlanIt runs over the description. Deliberately wide: the
// unit reader below does the real filtering, this only keeps the page small.
const RESIDENTIAL_SEARCH =
  "dwelling OR dwellings OR dwellinghouse OR dwellinghouses OR flat OR flats OR houses OR homes OR residential OR apartments OR maisonettes OR bungalows OR bungalow";

// Paperwork attached to a scheme rather than a scheme: discharging conditions,
// minor amendments, lawfulness certificates, tree works, adverts. Also plain
// householder extensions, which the search above catches on "dwelling".
const NOT_A_SCHEME = [
  /\b(details|submission)\s+(pursuant\s+to|of\s+details|required\s+by)\b/i,
  /\bdischarge\s+of\s+condition/i,
  /\bcompliance\s+with\s+condition/i,
  /\bnon[-\s]?material\s+amendment/i,
  /\bcertificate\s+of\s+lawful/i,
  /\blawful\s+development\s+certificate/i,
  /\bscreening\s+opinion\b/i,
  /\b(tree|trees|tpo)\b.*\b(works?|fell|felling|prune|pruning|crown)\b/i,
  /\badvertisement\s+consent\b/i,
  /\bprior\s+approval\b.*\bclass\s+a\b.*\bextension\b/i,
  /^\s*(single|two|first|part)[-\s]?(storey|story)[^.]*\bextension\b(?![^.]*\b(new|additional)\s+dwelling)/i,
  // "[^.]" won't do here — "8.00 metre rear extension" has a full stop in it.
  /\bprior\s+notification\s+for\s+a\s+(single|two|larger)[-\s]?(storey|story)?.{0,100}?\bextension\b/i,
  // A variation re-describes a scheme already stored under its original
  // application; counting it again would put the same site in front of Lucy twice.
  /\b(section\s+73|s\.?73)\b/i,
  /\b(variation|removal)\s+of\s+condition/i,
  // Neighbouring councils consulting this one, and appeal mirrors, aren't this
  // council's applications.
  /^\s*consultation\s+from\b/i,
  /^\s*online\s+appeal\s+presence\b/i,
];

const HOUSEHOLDER_TYPES = /householder|trees|advert|conditions|amendment|lawful/i;

interface PlanitRecord {
  name: string;
  uid: string;
  description: string | null;
  address: string | null;
  url: string | null;
  link: string | null;
  app_state: string | null;
  app_type: string | null;
  start_date: string | null;
  decided_date: string | null;
  other_fields: Record<string, string | number | null> | null;
}

interface Candidate {
  area: CoverageArea;
  record: PlanitRecord;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function field(record: PlanitRecord, key: string): string | null {
  const value = record.other_fields?.[key];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  // PlanIt's placeholder when the council page has the value but its scraper didn't.
  return text && !/^see source$/i.test(text) ? text : null;
}

/** PlanIt refuses any response over 1MB, which a year of Guildford already is. */
const WINDOW_CHUNK_DAYS = 45;

type PlanitWindow = { startDate: string; endDate: string } | { decided: number };

async function requestPlanit(params: URLSearchParams): Promise<{ records: PlanitRecord[] } | { error: string }> {
  try {
    const res = await fetch(`${PLANIT_URL}?${params}`, {
      headers: { "User-Agent": "IdealLand-Sourcing/1.0 (+https://idealland.co.uk)", Accept: "application/json" },
      signal: AbortSignal.timeout(90000),
    });
    const data = (await res.json().catch(() => ({}))) as { records?: PlanitRecord[]; error?: string };
    // A rate limit comes back with an `error` and sometimes a 200 — treat it as a
    // failed query, never as "no applications".
    if (data.error || !Array.isArray(data.records)) return { error: data.error ?? `HTTP ${res.status}` };
    return { records: data.records };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Longest PlanIt "try again in Ns" worth waiting for inside a scan. */
const MAX_RATE_LIMIT_WAIT_S = 240;

async function queryPlanit(authority: string, window: PlanitWindow): Promise<PlanitRecord[] | null> {
  const params = new URLSearchParams({
    auth: authority,
    search: RESIDENTIAL_SEARCH,
    pg_sz: "1000",
    select: "name,uid,description,address,url,link,app_state,app_type,start_date,decided_date,other_fields",
  });
  if ("decided" in window) {
    params.set("decided", String(window.decided));
  } else {
    params.set("start_date", window.startDate);
    params.set("end_date", window.endDate);
  }

  const first = await requestPlanit(params);
  if ("records" in first) return first.records;

  // PlanIt says exactly how long to back off; waiting that out once is politer
  // than dropping the district for a day.
  const waitSeconds = Number(first.error.match(/try again in (\d+)\s*s/i)?.[1]);
  if (waitSeconds && waitSeconds <= MAX_RATE_LIMIT_WAIT_S) {
    await sleep((waitSeconds + 5) * 1000);
    const retry = await requestPlanit(params);
    if ("records" in retry) return retry.records;
    console.warn(`[planit] ${authority} refused after waiting ${waitSeconds}s: ${retry.error}`);
    return null;
  }
  console.warn(`[planit] ${authority} refused: ${first.error}`);
  return null;
}

/** Submission-date windows covering the last `days`, newest first, each small enough for one response. */
function dateWindows(days: number): PlanitWindow[] {
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const windows: PlanitWindow[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  for (let offset = 0; offset < days; offset += WINDOW_CHUNK_DAYS) {
    const end = new Date(Date.now() - offset * dayMs);
    const start = new Date(Date.now() - Math.min(offset + WINDOW_CHUNK_DAYS - 1, days) * dayMs);
    windows.push({ startDate: isoDay(start), endDate: isoDay(end) });
  }
  return windows;
}

function looksLikeScheme(record: PlanitRecord): boolean {
  const description = record.description ?? "";
  if (!description.trim()) return false;
  if (record.app_type && HOUSEHOLDER_TYPES.test(record.app_type) && !/\bnew\s+dwelling/i.test(description)) return false;
  return !NOT_A_SCHEME.some((pattern) => pattern.test(description));
}

// ---------------------------------------------------------------------------
// Reading the number of new homes out of the description
// ---------------------------------------------------------------------------

function isClaudeConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!(key && !key.includes("PLACEHOLDER"));
}

/**
 * Homes proposed per description, by index — the same measure as the London
 * feed's "proposed residential units", so a 4-unit site means the same thing
 * in Kingston and in Elmbridge. null = not a residential scheme, or
 * the description doesn't say. Batched so a busy day is one call, not fifty.
 */
async function readNewHomes(descriptions: string[]): Promise<Array<number | null>> {
  if (descriptions.length === 0 || !isClaudeConfigured()) return descriptions.map(() => null);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const numbered = descriptions.map((d, i) => `${i + 1}. ${d.replace(/\s+/g, " ").slice(0, 600)}`).join("\n");

  try {
    const message = await withRetry(() =>
      client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 40 + descriptions.length * 12,
        messages: [
          {
            role: "user",
            content: `Each line below is an English planning application description. For each, give the number of self-contained homes (houses, flats, maisonettes, bungalows, dwellings) the proposal would build or create — the count a developer would buy the site for.

Rules:
- Count what is proposed, not the net change: "demolish 1 house and build 4" = 4. "convert 1 house into 3 flats" = 3. A replacement dwelling (demolish one, build one) = 1.
- Bedrooms are not homes: "a three-bedroom house" = 1.
- Extensions, annexes ancillary to an existing house, garages, HMOs, care homes, student rooms, hotels = 0.
- If the description gives no way to tell, use null.

Return ONLY a JSON array with one entry per line, in order, e.g. [3, 0, null].

${numbered}`,
          },
        ],
      })
    );
    const block = message.content[0];
    if (block.type !== "text") return descriptions.map(() => null);
    const raw = block.text.match(/\[[\s\S]*\]/)?.[0];
    const parsed = raw ? (JSON.parse(raw) as unknown[]) : [];
    return descriptions.map((_, i) => {
      const value = parsed[i];
      return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
    });
  } catch {
    return descriptions.map(() => null);
  }
}

// ---------------------------------------------------------------------------

function planningStatus(record: PlanitRecord): { status: string; decision: string | null } {
  const state = (record.app_state ?? "").trim().toLowerCase();
  if (!state || state === "undecided" || state === "unresolved") return { status: "submitted", decision: null };
  if (state === "permitted" || state === "conditions") return { status: "decided", decision: "Approved" };
  if (state === "rejected") return { status: "decided", decision: "Refused" };
  if (state === "withdrawn") return { status: "decided", decision: "Withdrawn" };
  return { status: "decided", decision: record.app_state };
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Stored reference — PlanIt's name ("Guildford/26/P/00590") is unique across councils. */
function referenceFor(record: PlanitRecord): string {
  return `PlanIt-${record.name}`;
}

async function hasRecentScan(): Promise<boolean> {
  const since = new Date(Date.now() - MIN_HOURS_BETWEEN_SCANS * 60 * 60 * 1000);
  const recent = await prisma.automationRun.findFirst({
    where: { type: RUN_TYPE, status: "completed", startedAt: { gte: since } },
  });
  return recent !== null;
}

/**
 * Pull new 1-9 home schemes for the Surrey districts and refresh the planning
 * status of the ones already stored. Once a day unless `force`; `windowDays`
 * widens the look-back for a first backfill.
 */
export async function scanSurrey(opts?: { windowDays?: number; force?: boolean }): Promise<{
  found: number;
  updated: number;
  checked: number;
  failedAreas: string[];
  skipped?: string;
}> {
  if (!opts?.force && (await hasRecentScan())) {
    return { found: 0, updated: 0, checked: 0, failedAreas: [], skipped: `Surrey was scanned in the last ${MIN_HOURS_BETWEEN_SCANS}h` };
  }

  const run = await prisma.automationRun.create({ data: { type: RUN_TYPE, status: "running" } });
  const windowDays = opts?.windowDays ?? 30;
  const areas = COVERAGE_AREAS.filter((a) => a.region === "surrey" && a.planitAuthority);

  try {
    const failedAreas: string[] = [];
    const candidates: Candidate[] = [];
    let answered = 0;
    let first = true;

    for (const area of areas) {
      // New applications, then recent decisions (which catches a stored live
      // lead being granted or refused).
      for (const window of [...dateWindows(windowDays), { decided: Math.min(windowDays, 14) }]) {
        if (!first) await sleep(PLANIT_GAP_MS);
        first = false;
        const records = await queryPlanit(area.planitAuthority!, window);
        if (!records) {
          if (!failedAreas.includes(area.council)) failedAreas.push(area.council);
          continue;
        }
        answered++;
        for (const record of records) candidates.push({ area, record });
      }
    }

    // One entry per application — the two queries overlap.
    const unique = new Map<string, Candidate>();
    for (const c of candidates) unique.set(referenceFor(c.record), c);

    const existing = await prisma.planningApplication.findMany({
      where: { reference: { in: [...unique.keys()] } },
      select: { id: true, reference: true, status: true, decision: true },
    });
    const existingByRef = new Map(existing.map((e) => [e.reference, e]));

    // Refresh the status of leads already stored.
    let updated = 0;
    for (const [reference, { record }] of unique) {
      const stored = existingByRef.get(reference);
      if (!stored) continue;
      const next = planningStatus(record);
      if (next.status === stored.status && next.decision === stored.decision) continue;
      await prisma.planningApplication.update({
        where: { id: stored.id },
        data: { status: next.status, decision: next.decision, decidedAt: parseDate(record.decided_date) },
      });
      updated++;
    }

    // New ones: shortlist on the description, then read the home count.
    const fresh = [...unique.entries()]
      .filter(([reference, c]) => !existingByRef.has(reference) && looksLikeScheme(c.record))
      .map(([, c]) => c);

    const counts: Array<number | null> = [];
    for (let i = 0; i < fresh.length; i += 40) {
      const batch = fresh.slice(i, i + 40);
      counts.push(...(await readNewHomes(batch.map((c) => c.record.description ?? ""))));
    }

    let found = 0;
    for (const [i, { area, record }] of fresh.entries()) {
      const units = counts[i];
      if (units === null || units < MIN_UNITS || units > MAX_UNITS) continue;

      const { status, decision } = planningStatus(record);
      const applicant = field(record, "applicant_company") ?? field(record, "applicant_name");
      const agentAddress = field(record, "agent_address");
      const agentName = cleanAgentName(field(record, "agent_name"));
      const agentFirm = field(record, "agent_company") ?? firmFromText(agentAddress?.split(",")[0] ?? null);
      const ownership = { applicant, ownershipStatus: null };

      await prisma.planningApplication.create({
        data: {
          reference: referenceFor(record),
          lpaReference: record.uid,
          council: area.council,
          address: record.address?.trim() || `${area.council} (ref ${record.uid})`,
          description: (record.description ?? "").trim(),
          units,
          status,
          decision,
          applicant,
          publicOwner: publicOwnerReason(ownership) !== null,
          publicOwnerReason: publicOwnerReason(ownership),
          councilUrl: cleanCouncilUrl(record.url),
          mirrorUrl: cleanCouncilUrl(record.link),
          // A head start for contact research, which reads the register and
          // searches for the practice's inbox before anything is marked found.
          agentName,
          agentFirm,
          agentPhone: field(record, "agent_tel"),
          submittedAt: parseDate(record.start_date) ?? new Date(),
          decidedAt: status === "decided" ? parseDate(record.decided_date) : null,
          // Reported in the morning digest instead of an instant alert, so a
          // backfill can't flood Telegram.
          alertSent: true,
          decisionAlertSent: status === "decided",
        },
      });
      found++;
    }

    await prisma.automationRun.update({
      where: { id: run.id },
      data: {
        // No query answered means nothing was checked — record a failure so
        // tomorrow's gate doesn't treat it as a completed scan.
        status: answered === 0 ? "failed" : "completed",
        completedAt: new Date(),
        summary: `Scanned ${areas.length} Surrey districts via PlanIt (last ${windowDays}d). ${fresh.length} residential applications read, ${found} new ${MIN_UNITS}-${MAX_UNITS} home schemes stored, ${updated} status updates.${
          failedAreas.length ? ` PlanIt refused some requests for: ${failedAreas.join(", ")} — the next daily scan fills the gap.` : ""
        }`,
      },
    });

    return { found, updated, checked: fresh.length, failedAreas };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.automationRun.update({
      where: { id: run.id },
      data: { status: "failed", completedAt: new Date(), error: message },
    });
    throw error;
  }
}

