import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { applyRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const failedRuns = await prisma.automationRun.findMany({
    where: { status: "failed" },
    orderBy: { startedAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ errors: failedRuns });
}

export async function DELETE(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 10 });
  if (rateLimitResponse) return rateLimitResponse;

  await prisma.automationRun.deleteMany({ where: { status: "failed" } });
  return NextResponse.json({ cleared: true });
}
