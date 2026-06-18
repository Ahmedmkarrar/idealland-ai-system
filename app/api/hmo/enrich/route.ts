import { NextRequest, NextResponse } from "next/server";
import { enrichHmoProperty, bulkEnrichHmo } from "@/lib/services/companies-house";
import { applyRateLimit } from "@/lib/rate-limit";

interface EnrichBody {
  propertyId?: string;
  bulk?: boolean;
  force?: boolean;
  limit?: number;
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 20 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = (await request.json().catch(() => ({}))) as EnrichBody;

  if (body.bulk) {
    const limit = typeof body.limit === "number" ? Math.min(body.limit, 80) : 40;
    const result = await bulkEnrichHmo(limit);
    return NextResponse.json(result);
  }

  if (!body.propertyId) {
    return NextResponse.json({ error: "propertyId or bulk=true required" }, { status: 400 });
  }

  const result = await enrichHmoProperty(body.propertyId, { force: body.force });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
