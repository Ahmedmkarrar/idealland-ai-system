// Personalised cold-email outreach service.
//
// For a given planning application, picks the best-fit mailing contacts
// (by tag match + type relevance), then Claude writes a custom email per
// recipient referencing the specific application. Drafts stored in the
// OutreachEmail table — staff approves on the dashboard before sending
// via Resend.
import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withRetry } from "@/lib/retry";

function isClaudeConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!(key && !key.includes("PLACEHOLDER"));
}

function isResendConfigured(): boolean {
  const key = process.env.RESEND_API_KEY;
  return !!(key && !key.includes("PLACEHOLDER"));
}

const MAX_RECIPIENTS_PER_APP = 5;

// How long a contact is rested after we last drafted or sent them something.
// Without this, pickContacts() scores purely on (council, units) and so returns
// the same top-five people for every similar application — one architect ends
// up with five near-identical emails from five different schemes in a week.
const CONTACT_COOLDOWN_DAYS = Number(process.env.OUTREACH_CONTACT_COOLDOWN_DAYS ?? 30);

// A contact scoring zero matches the scheme on nothing — not the borough, not
// the type, not the size band. Emailing them anyway is what makes outreach read
// as spam, so we would rather send four good emails than five padded ones.
const MIN_CONTACT_SCORE = 1;

const BRAND_CONTEXT = `IdealLand sources off-market London property opportunities. Tone: insider intelligence brief, never salesy. Keep emails ≤120 words. Open with the specific opportunity, give one concrete reason this recipient will care, end with a soft CTA ("Want the full pack?" / "Reply if you'd like to discuss.").`;

interface DraftedEmail {
  subject: string;
  body: string;
}

async function draftEmailForContact(
  contactName: string,
  contactCompany: string | null,
  contactType: string,
  council: string,
  units: number,
  address: string,
  description: string
): Promise<DraftedEmail | null> {
  if (!isClaudeConfigured()) return null;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const typeHint: Record<string, string> = {
    developer: "They build residential/mixed-use schemes at scale. They care about land cost, planning risk, and absorption.",
    architect: "They design schemes. They care about brief, design opportunity, and whether they can pitch to the applicant.",
    investor: "They fund or buy schemes. They care about yield, exit, and downside.",
  };

  try {
    const message = await withRetry(() =>
      client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: `${BRAND_CONTEXT}

Write ONE outreach email.

Recipient:
  Name: ${contactName}
  Company: ${contactCompany ?? "(unknown)"}
  Type: ${contactType} — ${typeHint[contactType] ?? ""}

The opportunity (just landed in our planning intel feed):
  Borough: ${council}
  Address: ${address}
  Units: ${units}
  Description: ${description}

Return JSON only:
{
  "subject": "<short, specific, no clickbait — reference borough + scheme size>",
  "body": "<the email body, plain text, addressed to ${contactName.split(" ")[0]}>"
}`,
          },
        ],
      })
    );

    const content = message.content[0];
    if (content.type !== "text") return null;

    const raw = content.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    const parsed = JSON.parse(raw) as Partial<DraftedEmail>;
    if (typeof parsed.subject !== "string" || typeof parsed.body !== "string") return null;

    return { subject: parsed.subject.trim(), body: parsed.body.trim() };
  } catch {
    return null;
  }
}

// Emails of contacts we've drafted or sent to inside the cooldown window, and
// so should rest. "failed" rows are excluded — a send that errored never
// reached the recipient, so it shouldn't cost them their turn.
async function recentlyContactedEmails(): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - CONTACT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);

  const recent = await prisma.outreachEmail.findMany({
    where: { createdAt: { gte: cutoff }, status: { in: ["draft", "sent"] } },
    select: { contactEmail: true },
    distinct: ["contactEmail"],
  });

  return new Set(recent.map((r) => r.contactEmail));
}

// Pick the best-fit subset of contacts for a given application.
// Strategy: prefer contacts whose tags overlap with the borough name or
// "residential" / "large-scale" cues; fall back to developers + investors first.
// Contacts inside the cooldown window are held back regardless of score.
async function pickContacts(council: string, units: number) {
  const all = await prisma.mailingContact.findMany({ where: { active: true } });
  if (all.length === 0) return { contacts: [], rested: 0 };

  const resting = await recentlyContactedEmails();
  const available = all.filter((c) => !resting.has(c.email));
  const rested = all.length - available.length;
  if (available.length === 0) return { contacts: [], rested };

  const boroughLower = council.toLowerCase();
  const scored = available.map((c) => {
    let score = 0;
    const tags = (c.tags ?? "").toLowerCase();
    if (tags.includes(boroughLower) || tags.includes("london")) score += 3;
    if (tags.includes("residential")) score += 2;
    if (units >= 25 && tags.includes("large-scale")) score += 2;
    if (units < 25 && tags.includes("small-scale")) score += 1;
    if (c.type === "developer") score += 2;
    if (c.type === "investor") score += 1;
    return { contact: c, score };
  });

  const relevant = scored
    .filter((s) => s.score >= MIN_CONTACT_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RECIPIENTS_PER_APP)
    .map((s) => s.contact);

  return { contacts: relevant, rested };
}

export async function generateOutreachForApp(
  applicationId: string
): Promise<{ drafted: number; skipped: number; reason?: string }> {
  if (!isClaudeConfigured()) {
    return { drafted: 0, skipped: 0, reason: "ANTHROPIC_API_KEY not configured" };
  }

  const app = await prisma.planningApplication.findUnique({ where: { id: applicationId } });
  if (!app) return { drafted: 0, skipped: 0, reason: "Application not found" };

  const existing = await prisma.outreachEmail.count({ where: { applicationId } });
  if (existing > 0) {
    return { drafted: 0, skipped: existing, reason: `${existing} draft(s) already exist for this app` };
  }

  const { contacts, rested } = await pickContacts(app.council, app.units);
  if (contacts.length === 0) {
    const reason = rested > 0
      ? `No eligible contacts — ${rested} resting inside the ${CONTACT_COOLDOWN_DAYS}-day cooldown`
      : "No active mailing contacts match this scheme";
    return { drafted: 0, skipped: 0, reason };
  }

  const runRecord = await prisma.automationRun.create({
    data: { type: "outreach", status: "running" },
  });

  let drafted = 0;
  let skipped = 0;

  for (const contact of contacts) {
    const draft = await draftEmailForContact(
      contact.name,
      contact.company,
      contact.type,
      app.council,
      app.units,
      app.address,
      app.description
    );

    if (!draft) {
      skipped++;
      continue;
    }

    try {
      await prisma.outreachEmail.create({
        data: {
          applicationId,
          contactEmail: contact.email,
          contactName: contact.name,
          subject: draft.subject,
          body: draft.body,
          status: "draft",
        },
      });
      drafted++;
    } catch (err) {
      // A concurrent request for the same app beat us to this contact. The
      // unique index on (applicationId, contactEmail) is what makes that safe;
      // treat it as a skip rather than failing the whole run.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        skipped++;
        continue;
      }
      throw err;
    }
  }

  await prisma.automationRun.update({
    where: { id: runRecord.id },
    data: {
      status: "completed",
      completedAt: new Date(),
      summary: `Drafted ${drafted} outreach email(s) for ${app.council} ${app.units}-unit scheme. ${skipped} skipped.${rested > 0 ? ` ${rested} contact(s) resting in cooldown.` : ""}`,
    },
  });

  return { drafted, skipped };
}

export async function sendOutreachEmail(
  outreachId: string
): Promise<{ ok: boolean; provider: "resend"; reason?: string; resendId?: string }> {
  const email = await prisma.outreachEmail.findUnique({ where: { id: outreachId } });
  if (!email) return { ok: false, provider: "resend", reason: "Outreach not found" };
  if (email.status === "sent") {
    return { ok: true, provider: "resend", reason: "Already sent" };
  }

  if (!isResendConfigured()) {
    return { ok: false, provider: "resend", reason: "RESEND_API_KEY not configured" };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = process.env.ALERT_EMAIL_FROM ?? "onboarding@resend.dev";

  try {
    const result = await withRetry(() =>
      resend.emails.send({
        from: fromEmail,
        to: [email.contactEmail],
        subject: email.subject,
        html: email.body
          .split("\n")
          .filter(Boolean)
          .map((line: string) => `<p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 12px 0">${line}</p>`)
          .join(""),
      })
    );

    if (result.error) {
      await prisma.outreachEmail.update({
        where: { id: outreachId },
        data: { status: "failed", errorMessage: result.error.message ?? "Resend rejected the send" },
      });
      return { ok: false, provider: "resend", reason: result.error.message };
    }

    await prisma.outreachEmail.update({
      where: { id: outreachId },
      data: { status: "sent", sentAt: new Date(), resendId: result.data?.id ?? null },
    });

    return { ok: true, provider: "resend", resendId: result.data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.outreachEmail.update({
      where: { id: outreachId },
      data: { status: "failed", errorMessage: msg },
    });
    return { ok: false, provider: "resend", reason: msg };
  }
}

// What came back after a send. Tracked separately from `status` (delivery
// state) so the two can't clobber each other — a reply doesn't unset the fact
// that we sent, and a resend doesn't erase the reply.
export const OUTREACH_OUTCOMES = ["replied", "interested", "dead", "closed-won"] as const;
export type OutreachOutcome = (typeof OUTREACH_OUTCOMES)[number];

export function isOutreachOutcome(value: string): value is OutreachOutcome {
  return (OUTREACH_OUTCOMES as readonly string[]).includes(value);
}

// Records (or clears, with null) what happened after an email went out.
export async function setOutreachOutcome(
  outreachId: string,
  outcome: OutreachOutcome | null
): Promise<{ ok: boolean; reason?: string }> {
  const email = await prisma.outreachEmail.findUnique({ where: { id: outreachId } });
  if (!email) return { ok: false, reason: "Outreach not found" };

  // An outcome only means something once the email has actually gone out.
  if (email.status !== "sent") {
    return { ok: false, reason: `Cannot record an outcome on a ${email.status} email` };
  }

  await prisma.outreachEmail.update({
    where: { id: outreachId },
    data: { outcome, outcomeAt: outcome ? new Date() : null },
  });

  return { ok: true };
}

export async function getOutreach(filters?: { applicationId?: string; status?: string; outcome?: string }) {
  return prisma.outreachEmail.findMany({
    where: {
      ...(filters?.applicationId && { applicationId: filters.applicationId }),
      ...(filters?.status && { status: filters.status }),
      ...(filters?.outcome && { outcome: filters.outcome }),
    },
    include: { application: true },
    orderBy: { createdAt: "desc" },
  });
}
