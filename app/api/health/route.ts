import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

// Public health-check endpoint for external uptime monitors (UptimeRobot,
// Pingdom, BetterStack, etc.). Returns 200 only if the app can talk to the
// DB; 503 otherwise. Never requires auth — intentionally world-readable so
// monitors don't need credentials.
//
// Shape kept small and stable so it's safe to alert on.
export async function GET() {
  const startedAt = Date.now();
  let dbReachable = false;
  let dbLatencyMs: number | null = null;
  let lastCronAt: string | null = null;
  let lastCronStatus: string | null = null;

  try {
    const t0 = Date.now();
    const lastRun = await prisma.automationRun.findFirst({
      orderBy: { startedAt: "desc" },
    });
    dbReachable = true;
    dbLatencyMs = Date.now() - t0;
    if (lastRun) {
      lastCronAt = lastRun.startedAt.toISOString();
      lastCronStatus = lastRun.status;
    }
  } catch {
    dbReachable = false;
  }

  const status = dbReachable ? 200 : 503;
  return NextResponse.json(
    {
      ok: dbReachable,
      uptimeSeconds: Math.round(process.uptime()),
      dbReachable,
      dbLatencyMs,
      lastCronAt,
      lastCronStatus,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    },
    { status }
  );
}
