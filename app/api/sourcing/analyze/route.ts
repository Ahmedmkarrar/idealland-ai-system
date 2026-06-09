import { NextRequest, NextResponse } from "next/server";
import { analyzeApplication, bulkAnalyze } from "@/lib/services/intelligence";
import { applyRateLimit } from "@/lib/rate-limit";

interface AnalyzeBody {
  applicationId?: string;
  bulk?: boolean;
  force?: boolean;
  limit?: number;
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 30 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = (await request.json().catch(() => ({}))) as AnalyzeBody;

  if (body.bulk) {
    const limit = typeof body.limit === "number" ? Math.min(body.limit, 50) : 20;
    const result = await bulkAnalyze(limit);
    return NextResponse.json(result);
  }

  if (!body.applicationId) {
    return NextResponse.json({ error: "applicationId or bulk=true required" }, { status: 400 });
  }

  const result = await analyzeApplication(body.applicationId, { force: body.force });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
