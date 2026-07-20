import { NextRequest, NextResponse } from "next/server";
import { generateOutreachForApp, generateOutreachForTopLeads, getOutreach } from "@/lib/services/outreach";
import { applyRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const applicationId = searchParams.get("applicationId") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const outcome = searchParams.get("outcome") ?? undefined;
  const outreach = await getOutreach({ applicationId, status, outcome });
  return NextResponse.json({ outreach });
}

interface GenerateBody {
  applicationId?: string;
  bulk?: boolean;
  minScore?: number;
  limit?: number;
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 10 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = (await request.json().catch(() => ({}))) as GenerateBody;

  // Bulk: draft outreach for the top undrafted leads in one call.
  if (body.bulk) {
    const result = await generateOutreachForTopLeads({
      minScore: typeof body.minScore === "number" ? body.minScore : undefined,
      limit: typeof body.limit === "number" ? body.limit : undefined,
    });
    return NextResponse.json(result);
  }

  if (!body.applicationId) {
    return NextResponse.json({ error: "applicationId or bulk=true required" }, { status: 400 });
  }

  const result = await generateOutreachForApp(body.applicationId);
  return NextResponse.json(result);
}
