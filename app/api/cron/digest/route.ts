import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit } from "@/lib/rate-limit";
import { sendDailyDigest } from "@/lib/services/email";
import { sendTelegramDigest } from "@/lib/services/telegram";
import { bulkFindContacts } from "@/lib/services/contact-finder";

const CRON_SECRET = process.env.CRON_SECRET;

// Contact research runs once a day, here rather than in the 4-hourly scan, and
// on a deliberately small batch: each lookup is a Claude call plus up to five web
// searches, so an unbounded sweep of ~2,000 leads would cost hundreds a month for
// research nobody has read yet. A steady trickle keeps a stocked queue of ready
// approach packs ahead of what one person can actually work through in a day.
//
// CONTACT_DAILY_LIMIT=0 turns it off entirely.
const CONTACT_DAILY_LIMIT = Number(process.env.CONTACT_DAILY_LIMIT ?? 15);
const CONTACT_DAILY_MIN_SCORE = Number(process.env.CONTACT_DAILY_MIN_SCORE ?? 6);

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
    // Research first, so the morning digest reflects contacts found today and
    // the dashboard already has usable approach packs when staff open it.
    const contacts =
      CONTACT_DAILY_LIMIT > 0
        ? await bulkFindContacts({
            minScore: CONTACT_DAILY_MIN_SCORE,
            limit: CONTACT_DAILY_LIMIT,
            autoDraft: true,
          }).catch((e) => ({ error: e instanceof Error ? e.message : "contact research failed" }))
        : { skipped: "CONTACT_DAILY_LIMIT=0" };

    const [telegram, email] = await Promise.allSettled([
      sendTelegramDigest(),
      sendDailyDigest(),
    ]);
    const pick = (r: PromiseSettledResult<unknown>) =>
      r.status === "fulfilled" ? r.value : { error: (r as PromiseRejectedResult).reason?.message };
    return NextResponse.json({
      ran: new Date().toISOString(),
      contacts,
      telegram: pick(telegram),
      email: pick(email),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ran: new Date().toISOString(), error: message }, { status: 500 });
  }
}
