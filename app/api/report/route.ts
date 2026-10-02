// "Report a problem" from a letter card. Lucy's checks used to reach us as
// WhatsApp screenshots; this files them on the Error Log page with the site
// attached, where the self-check's findings already go.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { applyRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 20 });
  if (rateLimitResponse) return rateLimitResponse;

  const { applicationId, message } = (await request.json().catch(() => ({}))) as {
    applicationId?: string;
    message?: string;
  };
  const text = message?.trim().slice(0, 2000);
  if (!applicationId || !text) return NextResponse.json({ error: "applicationId and message required" }, { status: 400 });

  const app = await prisma.planningApplication.findUnique({ where: { id: applicationId } });
  if (!app) return NextResponse.json({ error: "Application not found" }, { status: 404 });

  await prisma.automationRun.create({
    data: {
      type: "reported-by-lucy",
      status: "failed",
      completedAt: new Date(),
      summary: `${app.lpaReference ?? app.reference} · ${app.address} · contact: ${[app.agentName, app.agentFirm, app.agentEmail].filter(Boolean).join(", ") || "none"}`,
      error: text,
    },
  });
  return NextResponse.json({ ok: true });
}
