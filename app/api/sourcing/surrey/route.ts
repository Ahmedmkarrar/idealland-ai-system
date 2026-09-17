// Run the Surrey (PlanIt) scan on demand — used once for the first backfill, with
// a wider window than the daily scan. Needs the dashboard login or the cron token.
import { NextRequest, NextResponse } from "next/server";
import { scanSurrey } from "@/lib/services/planit";
import { applyRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 3 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = (await request.json().catch(() => ({}))) as { windowDays?: number };
  const windowDays =
    typeof body.windowDays === "number" ? Math.min(Math.max(Math.round(body.windowDays), 1), 365) : undefined;

  const result = await scanSurrey({ windowDays, force: true });
  return NextResponse.json(result);
}
