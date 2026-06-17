import { NextRequest, NextResponse } from "next/server";
import { analyzeHmoProperty, bulkAnalyzeHmo } from "@/lib/services/hmo-intelligence";
import { applyRateLimit } from "@/lib/rate-limit";

interface AnalyzeBody {
  propertyId?: string;
  bulk?: boolean;
  force?: boolean;
  limit?: number;
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 30 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = (await request.json().catch(() => ({}))) as AnalyzeBody;

  if (body.bulk) {
    const limit = typeof body.limit === "number" ? Math.min(body.limit, 50) : 25;
    const result = await bulkAnalyzeHmo(limit);
    return NextResponse.json(result);
  }

  if (!body.propertyId) {
    return NextResponse.json({ error: "propertyId or bulk=true required" }, { status: 400 });
  }

  const result = await analyzeHmoProperty(body.propertyId, { force: body.force });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
