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
    primeLeads,
    readyToSend,
    approachesSent,
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
    prisma.planningApplication.count({ where: { leadScore: { gte: 8 } } }),
    // A lead is "ready" once it has a named contact and a written approach email
    // and nobody has sent it yet — this is the queue on the /ready page.
    prisma.planningApplication.count({
      where: { contactStatus: "found", approachBody: { not: null }, approachStatus: { not: "sent" } },
    }),
    prisma.planningApplication.count({ where: { approachStatus: "sent" } }),
  ]);

  return NextResponse.json({
    sourcing: { totalApplications, approvedApplications, pendingApplications, primeLeads },
    outreach: { readyToSend, approachesSent },
    documents: { totalDocuments, retrievedDocuments, pendingDocuments: totalDocuments - retrievedDocuments },
    social: { totalPosts, publishedPosts, scheduledPosts },
    mailing: { totalContacts, sentMailCampaigns },
    recentRuns,
  });
}
