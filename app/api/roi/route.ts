// Client-facing ROI snapshot. Public (like the rest of /api/) so the money
// view renders without an auth round-trip.
import { NextRequest, NextResponse } from "next/server";
import { getRoiSnapshot } from "@/lib/services/roi";
import { applyRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const snapshot = await getRoiSnapshot();
  return NextResponse.json(snapshot);
}
