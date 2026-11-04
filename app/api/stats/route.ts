import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { COVERAGE_AREAS, inCoverage } from "@/lib/coverage";

export async function GET() {
  const [
    totalApplications,
    approvedApplications,
    pendingApplications,
    totalDocuments,
    retrievedDocuments,
    totalPosts,
    publishedPosts,
    scheduledPosts,
    totalContacts,
    sentMailCampaigns,
    recentRuns,
    primeLeads,
    readyToSend,
    approachesSent,
  ] = await Promise.all([
    prisma.planningApplication.count({ where: inCoverage }),
    prisma.planningApplication.count({ where: { ...inCoverage, status: "approved" } }),
    prisma.planningApplication.count({ where: { ...inCoverage, status: "submitted" } }),
    prisma.document.count(),
    prisma.document.count({ where: { status: "retrieved" } }),
    prisma.socialPost.count(),
    prisma.socialPost.count({ where: { status: "published" } }),
    prisma.socialPost.count({ where: { status: "scheduled" } }),
    prisma.mailingContact.count({ where: { active: true } }),
    prisma.mailingCampaign.count({ where: { status: "sent" } }),
    prisma.automationRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 10,
    }),
    prisma.planningApplication.count({ where: { ...inCoverage, leadScore: { gte: 8 } } }),
    // A lead is "ready" once it has a named contact and a written approach email
    // and nobody has sent it yet — this is the queue on the /ready page.
    prisma.planningApplication.count({
      where: { ...inCoverage, contactStatus: "found", approachBody: { not: null }, approachStatus: { notIn: ["sent", "discarded", "pending"] } },
    }),
    prisma.planningApplication.count({ where: { approachStatus: "sent" } }),
  ]);

  // Per area: is its feed alive, and what has it given Lucy this month.
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const [newest, recent, letters] = await Promise.all([
    prisma.planningApplication.groupBy({ by: ["council"], where: inCoverage, _max: { createdAt: true } }),
    prisma.planningApplication.groupBy({ by: ["council"], where: { ...inCoverage, createdAt: { gte: monthAgo } }, _count: true }),
    prisma.planningApplication.groupBy({
      by: ["council"],
      where: { ...inCoverage, contactStatus: "found", approachBody: { not: null }, approachStatus: { notIn: ["sent", "discarded", "pending"] } },
      _count: true,
    }),
  ]);
  const byCouncil = <T,>(rows: Array<{ council: string } & T>) => new Map(rows.map((r) => [r.council, r]));
  const newestBy = byCouncil(newest);
  const recentBy = byCouncil(recent);
  const lettersBy = byCouncil(letters);
  const coverage = COVERAGE_AREAS.map((a) => ({
    council: a.council,
    region: a.region,
    priority: a.priority === true,
    newestLeadAt: newestBy.get(a.council)?._max.createdAt ?? null,
    leadsLast30Days: recentBy.get(a.council)?._count ?? 0,
    readyToSend: lettersBy.get(a.council)?._count ?? 0,
  }));

  return NextResponse.json({
    coverage,
    sourcing: { totalApplications, approvedApplications, pendingApplications, primeLeads },
    outreach: { readyToSend, approachesSent },
    documents: { totalDocuments, retrievedDocuments, pendingDocuments: totalDocuments - retrievedDocuments },
    social: { totalPosts, publishedPosts, scheduledPosts },
    mailing: { totalContacts, sentMailCampaigns },
    recentRuns,
  });
}
