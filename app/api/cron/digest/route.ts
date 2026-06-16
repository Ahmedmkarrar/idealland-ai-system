import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit } from "@/lib/rate-limit";
import { sendDailyDigest } from "@/lib/services/email";
import { sendTelegramDigest } from "@/lib/services/telegram";

const CRON_SECRET = process.env.CRON_SECRET;

// Daily digest endpoint — fired once a morning by crontab (separate schedule
// from the 4-hourly /api/cron scan). Summarises the last 24h of finds to staff.
export async function GET(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 5 });
  if (rateLimitResponse) return rateLimitResponse;

  if (CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const [telegram, email] = await Promise.allSettled([
      sendTelegramDigest(),
      sendDailyDigest(),
    ]);
    const pick = (r: PromiseSettledResult<unknown>) =>
      r.status === "fulfilled" ? r.value : { error: (r as PromiseRejectedResult).reason?.message };
    return NextResponse.json({
      ran: new Date().toISOString(),
      telegram: pick(telegram),
      email: pick(email),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ran: new Date().toISOString(), error: message }, { status: 500 });
  }
}
