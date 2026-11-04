// Wandsworth, read straight from the council's register.
//
// Wandsworth moved its planning register to Agile Applications in September 2026
// (planning.wandsworth.gov.uk/wandsworth). Neither the London DataHub nor PlanIt
// has had a Wandsworth application since about 11 Sep, so without this source
// IdealLand's own borough sent nothing for seven weeks (Lucy, 4 Nov 2026).
//
// Agile's API answers only from the UK — from anywhere else every request is
// "blocked" — so this works on the droplet and fails on a dev laptop abroad. A
// search returns at most 300 applications, so it is run one day at a time.
//
// Each application found is shortlisted on its description (the same filter
// PlanIt uses), its home count is read from the description, and only then is
// its detail page fetched, which names the agent.

import { prisma } from "@/lib/db/client";
import { coverageArea } from "@/lib/coverage";
import { publicOwnerReason } from "@/lib/public-ownership";
import { agileContact } from "@/lib/services/portal-extract";
import { agileGet, text, wandsworthApplicationUrl, type AgileDetail, type AgileSummary } from "@/lib/services/agile-api";
import { looksLikeSchemeText, readNewHomes } from "@/lib/services/planit";

const MIN_UNITS = Number(process.env.PLANNING_MIN_UNITS ?? 1);
const MAX_UNITS = Number(process.env.PLANNING_MAX_UNITS ?? 9);
const REQUEST_GAP_MS = 600;
const RUN_TYPE = "sourcing-wandsworth";
const MIN_HOURS_BETWEEN_SCANS = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Every application Wandsworth validated in the last `days` days, one day per request. */
async function validatedSince(days: number): Promise<AgileSummary[]> {
  const out: AgileSummary[] = [];
  for (let back = days; back >= 0; back--) {
    const day = isoDay(new Date(Date.now() - back * 86_400_000));
    const page = await agileGet<{ total: number; results: AgileSummary[] } | unknown[]>(
      `/application/search?validDateFrom=${day}&validDateTo=${day}`
    );
    if (Array.isArray(page)) throw new Error(`Wandsworth register refused the search for ${day}`);
    out.push(...page.results);
    await sleep(REQUEST_GAP_MS);
  }
  return out;
}

function decisionOf(summary: AgileSummary): { status: string; decision: string | null } {
  const d = text(summary.decisionText);
  if (!summary.decisionDate || !d) return { status: "submitted", decision: null };
  if (/refus/i.test(d)) return { status: "decided", decision: "Refused" };
  if (/withdraw/i.test(d)) return { status: "decided", decision: "Withdrawn" };
  if (/approv|grant|permit/i.test(d)) return { status: "decided", decision: "Approved" };
  return { status: "decided", decision: d };
}

async function hasRecentScan(): Promise<boolean> {
  const since = new Date(Date.now() - MIN_HOURS_BETWEEN_SCANS * 3_600_000);
  return (await prisma.automationRun.findFirst({ where: { type: RUN_TYPE, status: "completed", startedAt: { gte: since } } })) !== null;
}

/**
 * Store new 1-9 home schemes Wandsworth validated in the last `windowDays` days
 * and refresh the status of the Wandsworth leads already stored. Once a day
 * unless `force`.
 */
export async function scanWandsworth(opts?: { windowDays?: number; force?: boolean }): Promise<{
  read: number;
  shortlisted: number;
  found: number;
  updated: number;
  skipped?: string;
}> {
  if (!opts?.force && (await hasRecentScan())) {
    return { read: 0, shortlisted: 0, found: 0, updated: 0, skipped: `Wandsworth was scanned in the last ${MIN_HOURS_BETWEEN_SCANS}h` };
  }
  const run = await prisma.automationRun.create({ data: { type: RUN_TYPE, status: "running" } });
  const council = coverageArea("Wandsworth")!.council;
  const windowDays = opts?.windowDays ?? 14;

  try {
    const summaries = await validatedSince(windowDays);

    // The DataHub stored Wandsworth leads under its own ids, so match on the
    // council's reference to avoid storing a site twice.
    const existing = await prisma.planningApplication.findMany({
      where: { council, lpaReference: { in: summaries.map((s) => s.reference) } },
      select: { id: true, lpaReference: true, status: true, decision: true },
    });
    const byRef = new Map(existing.map((e) => [e.lpaReference, e]));

    let updated = 0;
    for (const s of summaries) {
      const stored = byRef.get(s.reference);
      if (!stored) continue;
      const next = decisionOf(s);
      if (next.status === stored.status && next.decision === stored.decision) continue;
      await prisma.planningApplication.update({
        where: { id: stored.id },
        data: { ...next, decidedAt: next.status === "decided" && s.decisionDate ? new Date(s.decisionDate) : null },
      });
      updated++;
    }

    const shortlist = summaries.filter(
      (s) => !byRef.has(s.reference) && looksLikeSchemeText(s.proposal ?? "", s.applicationType)
    );
    const counts: Array<number | null> = [];
    for (let i = 0; i < shortlist.length; i += 40) {
      counts.push(...(await readNewHomes(shortlist.slice(i, i + 40).map((s) => s.proposal ?? ""))));
    }

    let found = 0;
    for (const [i, s] of shortlist.entries()) {
      const units = counts[i];
      if (units === null || units < MIN_UNITS || units > MAX_UNITS) continue;

      const detail = await agileGet<AgileDetail>(`/application/${s.id}`).catch(() => ({}) as AgileDetail);
      await sleep(REQUEST_GAP_MS);
      const contact = agileContact(detail);
      const { status, decision } = decisionOf(s);
      const applicant = text(detail.applicantSurname);
      const ownership = { applicant, ownershipStatus: null };
      const location = text(s.location) ?? `${council} (ref ${s.reference})`;

      await prisma.planningApplication.create({
        data: {
          reference: `Agile-Wandsworth-${s.reference}`,
          lpaReference: s.reference,
          council,
          address: location,
          description: (text(detail.fullProposal) ?? text(s.proposal) ?? "").replace(/\s+/g, " "),
          units,
          status,
          decision,
          applicant,
          publicOwner: publicOwnerReason(ownership) !== null,
          publicOwnerReason: publicOwnerReason(ownership),
          councilUrl: wandsworthApplicationUrl(s.id),
          agentName: contact.agentName,
          agentFirm: contact.agentFirm,
          agentEmail: contact.agentEmail,
          agentPhone: contact.agentPhone,
          submittedAt: s.validDate ? new Date(s.validDate) : new Date(),
          decidedAt: status === "decided" && s.decisionDate ? new Date(s.decisionDate) : null,
          // Reported in the morning digest, like Surrey, so a backfill can't flood Telegram.
          alertSent: true,
          decisionAlertSent: status === "decided",
        },
      });
      found++;
    }

    await prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        summary: `Read ${summaries.length} Wandsworth applications from the council register (last ${windowDays}d). ${shortlist.length} looked like schemes, ${found} new ${MIN_UNITS}-${MAX_UNITS} home schemes stored, ${updated} status updates.`,
      },
    });
    return { read: summaries.length, shortlisted: shortlist.length, found, updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.automationRun.update({ where: { id: run.id }, data: { status: "failed", completedAt: new Date(), error: message } });
    throw error;
  }
}
