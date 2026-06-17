import { NextRequest, NextResponse } from "next/server";
import { draftApproachLetter } from "@/lib/services/hmo-intelligence";
import { applyRateLimit } from "@/lib/rate-limit";

interface DraftBody {
  propertyId?: string;
  force?: boolean;
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 20 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = (await request.json().catch(() => ({}))) as DraftBody;

  if (!body.propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }

  const result = await draftApproachLetter(body.propertyId, { force: body.force });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
