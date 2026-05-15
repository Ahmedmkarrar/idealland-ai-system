import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit } from "@/lib/rate-limit";
import { scanCouncils } from "@/lib/services/sourcing";
import { checkDecisions } from "@/lib/services/decisions";
import { retrieveAllPendingDocuments } from "@/lib/services/documents";
import { publishScheduledPosts, syncEngagementMetrics } from "@/lib/services/social";
import { refreshCampaignMetrics } from "@/lib/services/ads";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 5 });
  if (rateLimitResponse) return rateLimitResponse;

  if (CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const results = await Promise.allSettled([
    scanCouncils(),
    checkDecisions(),
    retrieveAllPendingDocuments(),
    publishScheduledPosts(),
    syncEngagementMetrics(),
    refreshCampaignMetrics(),
  ]);

  const pick = (r: PromiseSettledResult<unknown>) =>
    r.status === "fulfilled" ? r.value : { error: (r as PromiseRejectedResult).reason?.message };

  return NextResponse.json({
    ran: new Date().toISOString(),
    sourcing: pick(results[0]),
    decisions: pick(results[1]),
    documents: pick(results[2]),
    social: pick(results[3]),
    engagement: pick(results[4]),
    ads: pick(results[5]),
  });
}
