import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit } from "@/lib/rate-limit";
import { ingestAllHmoSources, getHmoProperties, getHmoPortfolioOwners } from "@/lib/services/hmo";

export async function GET(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view"); // "portfolios" | default list
  const council = searchParams.get("council") ?? undefined;
  const minScore = searchParams.get("minScore") ? Number(searchParams.get("minScore")) : undefined;
  const ownerType = searchParams.get("ownerType") ?? undefined;

  if (view === "portfolios") {
    const owners = await getHmoPortfolioOwners();
    return NextResponse.json({ owners });
  }

  const properties = await getHmoProperties({ council, minScore, ownerType });
  return NextResponse.json({ properties });
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 5 });
  if (rateLimitResponse) return rateLimitResponse;

  const results = await ingestAllHmoSources();
  return NextResponse.json({ ran: new Date().toISOString(), results });
}
