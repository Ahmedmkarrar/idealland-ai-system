import { NextRequest, NextResponse } from "next/server";
import { generateOutreachForApp, getOutreach } from "@/lib/services/outreach";
import { applyRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const applicationId = searchParams.get("applicationId") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const outreach = await getOutreach({ applicationId, status });
  return NextResponse.json({ outreach });
}

interface GenerateBody {
  applicationId?: string;
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 10 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = (await request.json().catch(() => ({}))) as GenerateBody;
  if (!body.applicationId) {
    return NextResponse.json({ error: "applicationId required" }, { status: 400 });
  }

  const result = await generateOutreachForApp(body.applicationId);
  return NextResponse.json(result);
}
