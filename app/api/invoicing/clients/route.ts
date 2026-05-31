import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { applyRateLimit } from "@/lib/rate-limit";

const VALID_BILLING_MODELS = ["flat_monthly", "per_application"];
const VALID_STATUSES = ["active", "paused", "cancelled"];

export async function GET(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const clients = await prisma.client.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { invoices: true } } },
  });
  return NextResponse.json({ clients });
}

interface CreateClientBody {
  name?: string;
  email?: string;
  billingEmail?: string;
  billingModel?: string;
  monthlyRate?: number;
  perUnitRate?: number;
  currency?: string;
  notes?: string;
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 30 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = (await request.json().catch(() => ({}))) as CreateClientBody;

  if (!body.name || !body.email || !body.billingModel) {
    return NextResponse.json({ error: "name, email, and billingModel are required" }, { status: 400 });
  }
  if (!VALID_BILLING_MODELS.includes(body.billingModel)) {
    return NextResponse.json({ error: `billingModel must be one of ${VALID_BILLING_MODELS.join(", ")}` }, { status: 400 });
  }
  if (body.billingModel === "flat_monthly" && !body.monthlyRate) {
    return NextResponse.json({ error: "monthlyRate required for flat_monthly billing" }, { status: 400 });
  }
  if (body.billingModel === "per_application" && !body.perUnitRate) {
    return NextResponse.json({ error: "perUnitRate required for per_application billing" }, { status: 400 });
  }

  try {
    const client = await prisma.client.create({
      data: {
        name: body.name,
        email: body.email,
        billingEmail: body.billingEmail ?? null,
        billingModel: body.billingModel,
        monthlyRate: body.monthlyRate ?? null,
        perUnitRate: body.perUnitRate ?? null,
        currency: body.currency ?? "GBP",
        notes: body.notes ?? null,
      },
    });
    return NextResponse.json({ client }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "create failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

interface UpdateClientBody {
  id?: string;
  name?: string;
  email?: string;
  billingEmail?: string;
  billingModel?: string;
  monthlyRate?: number | null;
  perUnitRate?: number | null;
  currency?: string;
  status?: string;
  notes?: string | null;
}

export async function PATCH(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 30 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = (await request.json().catch(() => ({}))) as UpdateClientBody;
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const { id, ...updates } = body;
  try {
    const client = await prisma.client.update({ where: { id }, data: updates });
    return NextResponse.json({ client });
  } catch (error) {
    const message = error instanceof Error ? error.message : "update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 30 });
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    await prisma.client.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
