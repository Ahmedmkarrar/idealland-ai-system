import { NextRequest, NextResponse } from "next/server";
import { sendOutreachEmail } from "@/lib/services/outreach";
import { applyRateLimit } from "@/lib/rate-limit";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 30 });
  if (rateLimitResponse) return rateLimitResponse;

  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const result = await sendOutreachEmail(id);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
