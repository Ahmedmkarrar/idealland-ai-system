import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

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
    activeCampaigns,
    totalAdSpend,
    totalLeads,
    totalContacts,
    sentMailCampaigns,
    recentRuns,
  ] = await Promise.all([
    prisma.planningApplication.count(),
    prisma.planningApplication.count({ where: { status: "approved" } }),
    prisma.planningApplication.count({ where: { status: "submitted" } }),
    prisma.document.count(),
    prisma.document.count({ where: { status: "retrieved" } }),
    prisma.socialPost.count(),
    prisma.socialPost.count({ where: { status: "published" } }),
    prisma.socialPost.count({ where: { status: "scheduled" } }),
    prisma.adCampaign.count({ where: { status: "active" } }),
    prisma.adCampaign.aggregate({ _sum: { spent: true } }),
    prisma.adCampaign.aggregate({ _sum: { leads: true } }),
    prisma.mailingContact.count({ where: { active: true } }),
    prisma.mailingCampaign.count({ where: { status: "sent" } }),
    prisma.automationRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 10,
    }),
  ]);

  return NextResponse.json({
    sourcing: { totalApplications, approvedApplications, pendingApplications },
    documents: { totalDocuments, retrievedDocuments, pendingDocuments: totalDocuments - retrievedDocuments },
    social: { totalPosts, publishedPosts, scheduledPosts },
    ads: {
      activeCampaigns,
      totalSpend: totalAdSpend._sum.spent ?? 0,
      totalLeads: totalLeads._sum.leads ?? 0,
    },
    mailing: { totalContacts, sentMailCampaigns },
    recentRuns,
  });
}
