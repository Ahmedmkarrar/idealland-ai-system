import { NextRequest, NextResponse } from "next/server";
import { scanHistoricalDecisions } from "@/lib/services/sourcing";
import { applyRateLimit } from "@/lib/rate-limit";

interface BackfillBody {
  lookbackDays?: number;
}

// One-shot historical backfill of DECIDED applications (1-9 unit band) from the
// last N days, for reviewing past planning decisions. Defaults to 365 days,
// capped at ~3 years to bound the work.
export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 3 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = (await request.json().catch(() => ({}))) as BackfillBody;
  const lookbackDays =
    typeof body.lookbackDays === "number" ? Math.min(Math.max(body.lookbackDays, 1), 1095) : 365;

  const result = await scanHistoricalDecisions(lookbackDays);
  return NextResponse.json(result);
}
