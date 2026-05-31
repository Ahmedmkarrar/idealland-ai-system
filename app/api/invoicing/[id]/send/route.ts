import { NextRequest, NextResponse } from "next/server";
import { sendInvoice } from "@/lib/services/invoicing";
import { applyRateLimit } from "@/lib/rate-limit";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 30 });
  if (rateLimitResponse) return rateLimitResponse;

  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const result = await sendInvoice(id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "send failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
