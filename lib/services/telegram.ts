import { prisma } from "@/lib/db/client";
import { withRetry } from "@/lib/retry";

// Telegram notification channel. Chosen over email for internal alerts because
// it pushes instantly to staff phones with zero DNS/verification/deliverability
// overhead. Email (Resend) is kept only for external cold outreach. Both no-op
// gracefully when their env vars aren't set, so either can run independently.
//
// Setup (2 min):
//   1. Message @BotFather on Telegram → /newbot → copy the token.
//   2. Add the bot to your group/chat (or DM it), send any message.
//   3. Visit https://api.telegram.org/bot<TOKEN>/getUpdates → copy "chat":{"id":...}.
//   4. Put TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in .env.local.

const TELEGRAM_MAX_LEN = 4096;

function isTelegramConfigured(): boolean {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  return !!(token && chatId && !token.includes("PLACEHOLDER"));
}

// Telegram's HTML parse mode only allows a small tag set; everything else must
// be entity-escaped or the API rejects the message.
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Split on paragraph boundaries so a long digest never exceeds Telegram's
// 4096-char per-message limit.
function chunk(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_LEN) return [text];
  const parts: string[] = [];
  let current = "";
  for (const block of text.split("\n\n")) {
    if ((current + "\n\n" + block).length > TELEGRAM_MAX_LEN) {
      if (current) parts.push(current);
      current = block;
    } else {
      current = current ? `${current}\n\n${block}` : block;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export async function sendTelegramMessage(html: string): Promise<{ sent: boolean; reason?: string }> {
  if (!isTelegramConfigured()) {
    console.log("[telegram] TELEGRAM_BOT_TOKEN/CHAT_ID not set — skipping");
    return { sent: false, reason: "Telegram not configured" };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const chatId = process.env.TELEGRAM_CHAT_ID!;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  for (const part of chunk(html)) {
    await withRetry(async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: part,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Telegram API ${res.status}: ${body}`);
      }
      return res;
    });
  }

  return { sent: true };
}

interface PlanningAlertPayload {
  reference: string;
  address: string;
  council: string;
  units: number;
  description: string;
  submittedAt: Date;
}

// Real-time alert fired by the scan cron whenever new live applications land.
export async function sendTelegramAlert(applications: PlanningAlertPayload[]): Promise<{ sent: boolean; reason?: string }> {
  if (applications.length === 0) return { sent: false, reason: "no applications" };

  const count = applications.length;
  const header = `🏗️ <b>${count} new planning application${count > 1 ? "s" : ""} detected</b> — London\n`;
  const lines = applications
    .map(
      (a) =>
        `\n• <b>${a.units}-unit</b> — ${escapeHtml(a.council)}\n  ${escapeHtml(a.address)}\n  <code>${escapeHtml(a.reference)}</code>`
    )
    .join("");

  return sendTelegramMessage(header + lines);
}

// Morning digest — mirrors the email digest, ranked by AI lead score. Sends
// even on a quiet night so staff get a daily heartbeat that the system is live.
export async function sendTelegramDigest(): Promise<{ sent: boolean; count: number; reason?: string }> {
  if (!isTelegramConfigured()) {
    return { sent: false, count: 0, reason: "Telegram not configured" };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const apps = await prisma.planningApplication.findMany({
    where: { createdAt: { gte: since } },
    orderBy: [{ createdAt: "desc" }],
  });
  const ranked = [...apps].sort((a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0));
  const count = ranked.length;
  const today = new Date().toLocaleDateString("en-GB", { dateStyle: "full" });

  let body: string;
  if (count > 0) {
    const cards = ranked
      .map((app) => {
        const score = app.leadScore != null ? `${app.leadScore}/10` : "—";
        const brief = app.intelligenceSummary ? `\n  ${escapeHtml(app.intelligenceSummary)}` : "";
        return `\n• <b>${app.units}-unit</b> — ${escapeHtml(app.council)} (score <b>${score}</b>)\n  ${escapeHtml(app.address)}\n  <code>${escapeHtml(app.reference)}</code>${brief}`;
      })
      .join("");
    body = `☀️ <b>IdealLand daily digest</b> — ${escapeHtml(today)}\n\n${count} new live opportunit${count > 1 ? "ies" : "y"}, ranked by lead score:${cards}`;
  } else {
    body = `☀️ <b>IdealLand daily digest</b> — ${escapeHtml(today)}\n\nNo new qualifying opportunities in the last 24 hours. All 33 London boroughs scanned as scheduled — a quiet night, not a fault.`;
  }

  await sendTelegramMessage(body);
  return { sent: true, count };
}
