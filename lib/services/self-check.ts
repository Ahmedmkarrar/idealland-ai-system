// The nightly self-check: the audit that found the "Dear Joshua" letter, the
// wrong-firm letters and the stale decisions on 1 Oct 2026, run every morning so
// the next problem is caught before Lucy sends it rather than after.
//
// It repairs what is safe to repair (a letter whose lead changed since it was
// written is rewritten; a lead stuck mid-research goes back in the queue) and
// reports the rest. A run that finds anything to report is recorded as failed,
// so it appears on the Error Log page — staff-only, never in Lucy's digest.

import { prisma } from "@/lib/db/client";
import { COVERAGE_AREAS, inCoverage } from "@/lib/coverage";
import { buildApproachEmail, draftApproach, earlierSitesFor, sentSitesByAgent } from "@/lib/services/contact-finder";
import {
  extractContactFromPortal,
  isSupportedPortal,
  PORTAL_REQUEST_DELAY_MS,
  PortalBusyError,
} from "@/lib/services/portal-extract";
import { contactSource } from "@/lib/approach-state";
import { NAME_FROM_MAILBOX } from "@/lib/agent-name";
import { domainTakesMail } from "@/lib/email-domain";

const REGISTER_SAMPLE = Number(process.env.SELF_CHECK_REGISTER_SAMPLE ?? 6);
const STUCK_RESEARCH_HOURS = 6;
// A covered council that has stored no new lead in this long has most likely lost
// its feed. Wandsworth went quiet on 15 Sep 2026 when it changed registers and
// nobody knew until Lucy asked on 4 Nov.
const QUIET_FEED_DAYS = Number(process.env.SELF_CHECK_QUIET_FEED_DAYS ?? 14);
const PLACEHOLDER_TEXT = /\[|\]|undefined|\bnull\b|NaN|\{|\}| 0 residential/;
const TIME_GREETING = /^\s*Good (morning|afternoon),/i;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sameText = (a: string, b: string) =>
  a.replace(TIME_GREETING, "").trim() === b.replace(TIME_GREETING, "").trim();
const comparable = (v: string | null) =>
  (v ?? "").toLowerCase().replace(/\b(ltd|limited|llp|mr|mrs|ms|dr)\b/g, "").replace(/[^a-z0-9]/g, "");

export interface SelfCheckResult {
  lettersChecked: number;
  rewritten: number;
  requeued: number;
  registerChecked: number;
  issues: string[];
}

export async function runSelfCheck(): Promise<SelfCheckResult> {
  const run = await prisma.automationRun.create({ data: { type: "self-check", status: "running" } });
  const issues: string[] = [];
  let rewritten = 0;

  const letters = await prisma.planningApplication.findMany({
    where: { ...inCoverage, approachStatus: { in: ["drafted", "pending"] }, approachBody: { not: null }, publicOwner: false },
  });

  const byAgent = await sentSitesByAgent();
  for (const lead of letters) {
    const ref = lead.lpaReference ?? lead.reference;

    // A letter written before its lead changed (a decision, a corrected unit
    // count or agent) no longer says what the lead says. Rewrite it.
    const expected = buildApproachEmail({ ...lead, earlierSites: earlierSitesFor(lead, byAgent) });
    if (!sameText(expected.body, lead.approachBody ?? "") || expected.subject !== lead.approachSubject) {
      await draftApproach(lead.id, { force: true, byAgent });
      rewritten++;
    }

    if (PLACEHOLDER_TEXT.test(expected.body)) issues.push(`${ref}: letter contains placeholder text`);

    // Only the register or Lucy may put a name in "Dear ___".
    // A name read from the agent's own mailbox (lib/agent-name.ts) is theirs.
    if (/^Dear /.test(expected.body) && contactSource(lead.contactNotes) === "web" && !lead.contactNotes?.includes(NAME_FROM_MAILBOX)) {
      issues.push(`${ref}: letter greets ${lead.agentName} but the name came from web search`);
    }
    if (lead.agentEmail && !(await domainTakesMail(lead.agentEmail))) {
      issues.push(`${ref}: letter is to ${lead.agentEmail}, but that domain can't receive email (a typo, or an invented address)`);
    }
    if (lead.contactStatus !== "found") {
      issues.push(`${ref}: letter waiting to send but the contact is "${lead.contactStatus ?? "unresearched"}"`);
    }
  }

  // Research interrupted mid-run (a restart, a crash) leaves a lead that the
  // daily queue never picks up again.
  const stuck = await prisma.planningApplication.updateMany({
    where: {
      contactStatus: "researching",
      updatedAt: { lt: new Date(Date.now() - STUCK_RESEARCH_HOURS * 3600_000) },
    },
    data: { contactStatus: null },
  });

  // Re-read a few register-backed letters against the register: catches a
  // register that has changed, or a reader that has quietly stopped matching.
  const sample = letters
    .filter((l) => contactSource(l.contactNotes) === "register" && isSupportedPortal(l.councilUrl))
    .sort(() => Math.random() - 0.5)
    .slice(0, REGISTER_SAMPLE);
  let registerChecked = 0;
  for (const lead of sample) {
    try {
      const read = await extractContactFromPortal(lead.councilUrl);
      registerChecked++;
      const ref = lead.lpaReference ?? lead.reference;
      if (!read) {
        issues.push(`${ref}: register no longer names an agent (we have ${lead.agentName ?? lead.agentFirm})`);
      } else if (read.agentName && lead.agentName && comparable(read.agentName) !== comparable(lead.agentName)) {
        issues.push(`${ref}: register names ${read.agentName}, letter is to ${lead.agentName}`);
      } else if (!read.agentName && read.agentFirm && lead.agentFirm && comparable(read.agentFirm) !== comparable(lead.agentFirm)) {
        issues.push(`${ref}: register names ${read.agentFirm}, letter is to ${lead.agentFirm}`);
      }
    } catch (error) {
      if (!(error instanceof PortalBusyError)) throw error;
    }
    await sleep(PORTAL_REQUEST_DELAY_MS * 2);
  }

  // The other automations, as the Error Log already records them.
  const failedRuns = await prisma.automationRun.findMany({
    where: {
      status: "failed",
      type: { notIn: ["self-check", "reported-by-lucy"] },
      startedAt: { gt: new Date(Date.now() - 24 * 3600_000) },
    },
    select: { type: true },
  });
  for (const type of new Set(failedRuns.map((r) => r.type))) issues.push(`The ${type} job failed in the last 24 hours`);

  for (const quiet of await quietCouncils()) {
    issues.push(
      quiet.newest
        ? `${quiet.council}: no new lead since ${quiet.newest.toISOString().slice(0, 10)} — check its feed is still running`
        : `${quiet.council}: no leads stored at all — check its feed`
    );
  }

  const result: SelfCheckResult = {
    lettersChecked: letters.length,
    rewritten,
    requeued: stuck.count,
    registerChecked,
    issues,
  };
  const summary =
    `Checked ${letters.length} letters: ${rewritten} rewritten to match their lead, ` +
    `${stuck.count} stuck leads requeued, ${registerChecked} re-read against the register.`;
  await prisma.automationRun.update({
    where: { id: run.id },
    data: {
      status: issues.length ? "failed" : "completed",
      completedAt: new Date(),
      summary,
      error: issues.length ? `${issues.length} to look at:\n${issues.join("\n")}` : null,
    },
  });
  return result;
}

/** Covered councils whose newest stored lead is older than QUIET_FEED_DAYS. */
export async function quietCouncils(): Promise<Array<{ council: string; newest: Date | null }>> {
  const newest = await prisma.planningApplication.groupBy({
    by: ["council"],
    where: inCoverage,
    _max: { createdAt: true },
  });
  const byCouncil = new Map(newest.map((n) => [n.council, n._max.createdAt]));
  const cutoff = Date.now() - QUIET_FEED_DAYS * 86_400_000;
  return COVERAGE_AREAS.map((a) => ({ council: a.council, newest: byCouncil.get(a.council) ?? null })).filter(
    (q) => !q.newest || q.newest.getTime() < cutoff
  );
}
