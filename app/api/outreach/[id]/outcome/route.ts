// Records what came back after an outreach email was sent, so the pipeline has
// a measurable end (replied → interested → closed-won) rather than stopping at
// "we sent it".
import { NextRequest, NextResponse } from "next/server";
import { isOutreachOutcome, setOutreachOutcome } from "@/lib/services/outreach";
import { applyRateLimit } from "@/lib/rate-limit";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 30 });
  if (rateLimitResponse) return rateLimitResponse;

  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const outcome = body?.outcome ?? null;

  // null is a valid input — it clears an outcome set by mistake.
  if (outcome !== null && (typeof outcome !== "string" || !isOutreachOutcome(outcome))) {
    return NextResponse.json(
      { error: "outcome must be one of: replied, interested, dead, closed-won — or null to clear" },
      { status: 400 }
    );
  }

  const result = await setOutreachOutcome(id, outcome);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
