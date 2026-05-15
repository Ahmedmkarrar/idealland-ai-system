import { NextRequest, NextResponse } from "next/server";
import { createCampaign, activateCampaign, pauseCampaign, refreshCampaignMetrics, getCampaigns } from "@/lib/services/ads";
import { applyRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const campaigns = await getCampaigns({ platform, status });
  return NextResponse.json({ campaigns });
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 10 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = await request.json().catch(() => ({}));

  if (body.action === "activate" && body.campaignId) {
    await activateCampaign(body.campaignId);
    return NextResponse.json({ success: true });
  }

  if (body.action === "pause" && body.campaignId) {
    await pauseCampaign(body.campaignId);
    return NextResponse.json({ success: true });
  }

  if (body.action === "refresh") {
    await refreshCampaignMetrics();
    return NextResponse.json({ success: true });
  }

  const result = await createCampaign({
    name: body.name ?? "IdealLand Architects Campaign",
    platform: body.platform ?? "instagram",
    budget: body.budget ?? 500,
    targetAudience: body.targetAudience ?? ["architects", "developers"],
    startDate: body.startDate ? new Date(body.startDate) : undefined,
    endDate: body.endDate ? new Date(body.endDate) : undefined,
  });

  return NextResponse.json(result);
}
