import { prisma } from "@/lib/db/client";
import { sendDecisionAlert } from "@/lib/services/email";
import { draftApproach } from "@/lib/services/contact-finder";
import { PLD_SEARCH_URL, parseUkDate } from "@/lib/services/sourcing";
import { inCoverage } from "@/lib/coverage";

// Keeping London leads' decisions current.
//
// London leads come from the Planning London DataHub, and a lead used to keep
// whatever status it had on the day it was imported. The old checker scraped
// Idox with our internal id as the keyVal, so it never matched an application
// and re-checked the same 50 leads every run. On 1 Oct 2026 twelve of the 27
// London letters waiting on the Ready page were for applications the council had
// since decided — nine approved, so the letter said "I came across the
// application" instead of "your client has received planning permission".
//
// The DataHub carries the council's decision, so it is asked directly for every
// undecided London lead. Surrey leads are refreshed from PlanIt in planit.ts.

const PLD_BATCH = 300;
// The DataHub's placeholder while an application is still open.
const UNDECIDED = /^(unknown|application (received|under consideration)|pending|registered)$/i;

interface PldDecision {
  id: string;
  decision?: string | null;
  decision_date?: string | null;
}

async function fetchDecisions(ids: string[]): Promise<PldDecision[]> {
  const res = await fetch(PLD_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      size: ids.length,
      _source: ["id", "decision", "decision_date"],
      query: { bool: { filter: [{ terms: { id: ids } }] } },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Planning London DataHub returned ${res.status}`);
  const data = (await res.json()) as { hits?: { hits?: Array<{ _source?: PldDecision }> } };
  return (data.hits?.hits ?? []).map((h) => h._source).filter((s): s is PldDecision => !!s?.id);
}

/**
 * Record what the council decided on every undecided London lead we still care
 * about, and rewrite any unsent letter so its wording follows the decision.
 * `alert: false` skips the per-decision email, for a backlog catch-up.
 */
export async function checkDecisions(options?: { alert?: boolean }): Promise<{
  checked: number;
  changed: number;
  redrafted: number;
}> {
  const alert = options?.alert ?? true;
  const runRecord = await prisma.automationRun.create({
    data: { type: "decisions", status: "running" },
  });

  try {
    const pending = await prisma.planningApplication.findMany({
      where: {
        NOT: [{ status: "decided" }, { reference: { startsWith: "PlanIt-" } }],
        OR: [inCoverage, { approachStatus: { not: null } }],
      },
      select: {
        id: true, reference: true, address: true, council: true, units: true, status: true,
        approachStatus: true, approachBody: true,
      },
    });

    let changed = 0;
    let redrafted = 0;
    for (let i = 0; i < pending.length; i += PLD_BATCH) {
      const batch = pending.slice(i, i + PLD_BATCH);
      const decisions = new Map((await fetchDecisions(batch.map((a) => a.reference))).map((d) => [d.id, d]));

      for (const app of batch) {
        const decision = decisions.get(app.reference)?.decision?.trim();
        if (!decision || UNDECIDED.test(decision)) continue;

        await prisma.applicationStatusChange.create({
          data: { applicationId: app.id, fromStatus: app.status, toStatus: "decided", alertSent: alert },
        });
        await prisma.planningApplication.update({
          where: { id: app.id },
          data: {
            status: "decided",
            decision,
            decidedAt: parseUkDate(decisions.get(app.reference)?.decision_date) ?? new Date(),
            decisionAlertSent: true,
          },
        });
        if (app.approachBody && app.approachStatus !== "sent") {
          const result = await draftApproach(app.id, { force: true });
          if (result.ok) redrafted++;
        }
        if (alert) {
          await sendDecisionAlert({
            reference: app.reference,
            address: app.address,
            council: app.council,
            units: app.units,
            fromStatus: app.status,
            toStatus: /approv|grant|permit/i.test(decision) ? "approved" : /refus/i.test(decision) ? "refused" : decision.toLowerCase(),
          });
        }
        changed++;
      }
    }

    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        summary: `Checked ${pending.length} undecided London applications. ${changed} decision${changed === 1 ? "" : "s"} recorded, ${redrafted} unsent letter${redrafted === 1 ? "" : "s"} rewritten.`,
      },
    });

    return { checked: pending.length, changed, redrafted };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: { status: "failed", completedAt: new Date(), error: message },
    });
    throw error;
  }
}

export async function getStatusHistory(applicationId: string) {
  return prisma.applicationStatusChange.findMany({
    where: { applicationId },
    orderBy: { changedAt: "desc" },
  });
}
