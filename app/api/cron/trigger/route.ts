import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit } from "@/lib/rate-limit";
import { scanCouncils } from "@/lib/services/sourcing";
import { checkDecisions } from "@/lib/services/decisions";
import { retrieveAllPendingDocuments } from "@/lib/services/documents";

// User-triggered cron — bypasses the bearer-secret check that /api/cron uses
// because the dashboard's middleware-gated session already authenticates the
// caller. Runs the same three services as the scheduled cron.
export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 5 });
  if (rateLimitResponse) return rateLimitResponse;

  const results = await Promise.allSettled([
    scanCouncils(),
    checkDecisions(),
    retrieveAllPendingDocuments(),
  ]);

  const pick = (r: PromiseSettledResult<unknown>) =>
    r.status === "fulfilled" ? r.value : { error: (r as PromiseRejectedResult).reason?.message };

  return NextResponse.json({
    triggeredBy: "dashboard",
    ran: new Date().toISOString(),
    sourcing: pick(results[0]),
    decisions: pick(results[1]),
    documents: pick(results[2]),
  });
}
