import { NextRequest, NextResponse } from "next/server";
import { scanCouncils, getApplications } from "@/lib/services/sourcing";
import { applyRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? undefined;
  const council = searchParams.get("council") ?? undefined;
  const minUnits = searchParams.get("minUnits") ? Number(searchParams.get("minUnits")) : undefined;

  const applications = await getApplications({ status, council, minUnits });
  return NextResponse.json({ applications });
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 10 });
  if (rateLimitResponse) return rateLimitResponse;

  const result = await scanCouncils();
  return NextResponse.json(result);
}
