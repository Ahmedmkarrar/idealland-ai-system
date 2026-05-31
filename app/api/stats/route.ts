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
    mailing: { totalContacts, sentMailCampaigns },
    recentRuns,
  });
}
