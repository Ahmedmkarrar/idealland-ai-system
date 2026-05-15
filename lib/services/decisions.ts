import { prisma } from "@/lib/db/client";
import { sendDecisionAlert } from "@/lib/services/email";
import { withRetry } from "@/lib/retry";
import * as cheerio from "cheerio";
import { IDOX_COUNCIL_DOMAIN_MAP } from "@/lib/constants/councils";

const DECISION_STATUS_MAP: Record<string, string> = {
  "application permitted": "approved",
  "permission granted": "approved",
  "conditionally permitted": "approved",
  "conditional permission": "approved",
  "approved with conditions": "approved",
  "approved": "approved",
  "grant of planning permission": "approved",
  "planning permission granted": "approved",
  "application refused": "refused",
  "refused": "refused",
  "refusal of planning permission": "refused",
  "planning permission refused": "refused",
  "rejection": "refused",
  "withdrawn": "withdrawn",
  "application withdrawn": "withdrawn",
  "appeal allowed": "approved",
  "appeal dismissed": "refused",
};

const COUNCIL_DOMAIN_MAP = IDOX_COUNCIL_DOMAIN_MAP;

async function scrapeApplicationStatus(
  council: string,
  reference: string
): Promise<string | null> {
  const domain = COUNCIL_DOMAIN_MAP[council];
  if (!domain) return null;

  try {
    const url = `https://${domain}/online-applications/applicationDetails.do?keyVal=${encodeURIComponent(reference)}&activeTab=summary`;
    const response = await withRetry(() =>
      fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; planning-monitor/1.0)" },
        signal: AbortSignal.timeout(10000),
      })
    );

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);

    // Collect all candidate text from known status containers across Idox variants
    const candidateSelectors = [
      "span.statusType",
      ".statusType",
      "td.statusType",
      "#applicationStatus",
      ".decision-status",
      "th:contains('Status') + td",
      "th:contains('Decision') + td",
      "td:contains('Status') + td",
      "td:contains('Decision') + td",
      "label:contains('Status') + span",
      "label:contains('Decision') + span",
      ".applicationDetails tr:contains('Status') td:last-child",
      ".applicationDetails tr:contains('Decision') td:last-child",
    ];

    for (const selector of candidateSelectors) {
      const text = $(selector).first().text().trim().toLowerCase();
      if (!text) continue;
      for (const [keyword, mapped] of Object.entries(DECISION_STATUS_MAP)) {
        if (text.includes(keyword)) return mapped;
      }
    }

    // Fallback: scan full page body for decision keywords (less precise but catches edge cases)
    const bodyText = $("body").text().toLowerCase();
    const decisionSection = bodyText.substring(
      Math.max(0, bodyText.indexOf("decision")),
      Math.min(bodyText.length, bodyText.indexOf("decision") + 300)
    );
    for (const [keyword, mapped] of Object.entries(DECISION_STATUS_MAP)) {
      if (decisionSection.includes(keyword)) return mapped;
    }

    return null;
  } catch {
    return null;
  }
}

export async function checkDecisions(): Promise<{ checked: number; changed: number }> {
  const runRecord = await prisma.automationRun.create({
    data: { type: "decisions", status: "running" },
  });

  try {
    const pendingApplications = await prisma.planningApplication.findMany({
      where: { status: "submitted", decisionAlertSent: false },
      orderBy: { submittedAt: "asc" },
      take: 50,
    });

    let checked = 0;
    let changed = 0;

    for (const app of pendingApplications) {
      const newStatus = await scrapeApplicationStatus(app.council, app.reference);
      checked++;

      if (!newStatus || newStatus === app.status) continue;

      await prisma.applicationStatusChange.create({
        data: {
          applicationId: app.id,
          fromStatus: app.status,
          toStatus: newStatus,
          alertSent: false,
        },
      });

      await prisma.planningApplication.update({
        where: { id: app.id },
        data: {
          status: newStatus,
          decidedAt: ["approved", "refused", "withdrawn"].includes(newStatus) ? new Date() : null,
          decisionAlertSent: true,
        },
      });

      await sendDecisionAlert({
        reference: app.reference,
        address: app.address,
        council: app.council,
        units: app.units,
        fromStatus: app.status,
        toStatus: newStatus,
      });

      changed++;
    }

    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        summary: `Checked ${checked} pending applications. ${changed} decision${changed === 1 ? "" : "s"} detected.`,
      },
    });

    return { checked, changed };
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
