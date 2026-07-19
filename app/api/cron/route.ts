import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit } from "@/lib/rate-limit";
import { scanCouncils } from "@/lib/services/sourcing";
import { checkDecisions } from "@/lib/services/decisions";
import { retrieveAllPendingDocuments } from "@/lib/services/documents";
import { bulkAnalyze } from "@/lib/services/intelligence";

const CRON_SECRET = process.env.CRON_SECRET;

// How many unanalysed leads to AI-score per cron run. Keeps each run bounded
// while steadily clearing any backlog (newest submissions first). Tunable via
// CRON_ANALYZE_LIMIT; Haiku keeps this a few cents per run.
const ANALYZE_LIMIT = Number(process.env.CRON_ANALYZE_LIMIT ?? 60);

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
  ]);

  const pick = (r: PromiseSettledResult<unknown>) =>
    r.status === "fulfilled" ? r.value : { error: (r as PromiseRejectedResult).reason?.message };

  // Score freshly-sourced (and any backlog) leads AFTER sourcing so the
  // dashboard and daily digest always have intelligence briefs + lead scores.
  // Runs last because it depends on rows scanCouncils() just wrote.
  const analysis = await bulkAnalyze(ANALYZE_LIMIT).catch((e) => ({
    error: e instanceof Error ? e.message : "analysis failed",
  }));

  return NextResponse.json({
    ran: new Date().toISOString(),
    sourcing: pick(results[0]),
    decisions: pick(results[1]),
    documents: pick(results[2]),
    analysis,
  });
}
