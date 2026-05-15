import { NextRequest, NextResponse } from "next/server";
import { retrieveDocuments, retrieveAllPendingDocuments, getDocuments } from "@/lib/services/documents";
import { applyRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const applicationId = searchParams.get("applicationId") ?? undefined;
  const documents = await getDocuments(applicationId);
  return NextResponse.json({ documents });
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 10 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = await request.json().catch(() => ({}));

  if (body.applicationId) {
    const result = await retrieveDocuments(body.applicationId);
    return NextResponse.json(result);
  }

  const result = await retrieveAllPendingDocuments();
  return NextResponse.json(result);
}
