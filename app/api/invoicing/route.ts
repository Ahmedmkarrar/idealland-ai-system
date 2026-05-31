import { NextRequest, NextResponse } from "next/server";
import { generateInvoicesForPeriod, getInvoices, isXeroConfigured } from "@/lib/services/invoicing";
import { applyRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("clientId") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const invoices = await getInvoices({ clientId, status });
  return NextResponse.json({ invoices, xeroConfigured: isXeroConfigured() });
}

interface GenerateBody {
  action?: string;
  periodStart?: string;
  periodEnd?: string;
}

// POST { action: "generate", periodStart?, periodEnd? }
// Defaults to the current calendar month if no dates supplied.
export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 10 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = (await request.json().catch(() => ({}))) as GenerateBody;

  if (body.action && body.action !== "generate") {
    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }

  const now = new Date();
  const periodStart = body.periodStart ? new Date(body.periodStart) : new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = body.periodEnd ? new Date(body.periodEnd) : new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const result = await generateInvoicesForPeriod({ periodStart, periodEnd });
  return NextResponse.json(result);
}
