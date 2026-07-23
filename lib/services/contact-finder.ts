// Contact discovery — the labour-intensive heart of IdealLand's real workflow.
//
// When the AI surfaces a suitable planning application, IdealLand must reach the
// person who FILED it (usually the agent — architect / planning consultant —
// sometimes the owner) to ask whether the owner will sell the site. That contact
// is almost never in the GLA planning feed; it lives on the council's own portal
// page and, for email/phone, on the firm's website or LinkedIn. Finding it by
// hand is what makes the job slow.
//
// findAgentContact() does that legwork with Claude + web search:
//   1. reads the council application page + searches the web for the agent/firm
//   2. returns agent name, firm, email, phone, website
// draftApproach() then writes the seller-approach email to that agent.
//
// Honest limit: contact emails aren't in any public dataset and LinkedIn can't be
// scraped, so this collapses ~an hour of manual research to a reviewed dossier —
// not a guaranteed auto-contact. The UI hands staff LinkedIn/Google/council links
// to finish the last mile.
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/client";
import { withRetry } from "@/lib/retry";

const MODEL = "claude-haiku-4-5-20251001";

function isClaudeConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!(key && !key.includes("PLACEHOLDER"));
}

interface ContactResult {
  agentName: string | null;
  agentFirm: string | null;
  agentEmail: string | null;
  agentPhone: string | null;
  agentWebsite: string | null;
  notes: string | null;
  found: boolean;
}

// Pull the final assistant text out of a (possibly multi-round) web-search
// response, resuming the server-tool loop if it pauses. Web search runs
// server-side, so we only read the text it produces at the end.
async function runWithWebSearch(client: Anthropic, prompt: string): Promise<string | null> {
  const tools = [{ type: "web_search_20250305" as const, name: "web_search" as const, max_uses: 5 }];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

  for (let round = 0; round < 4; round++) {
    const res = await withRetry(() =>
      client.messages.create({ model: MODEL, max_tokens: 1024, tools, messages })
    );

    if (res.stop_reason === "pause_turn") {
      // Server hit its per-turn tool cap — resend to let it continue.
      messages.push({ role: "assistant", content: res.content });
      continue;
    }

    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }
  return null;
}

function parseJson<T>(raw: string): T | null {
  const cleaned = raw
    .replace(/^[\s\S]*?```(?:json)?\s*/i, (m) => (m.includes("```") ? "" : m))
    .replace(/```[\s\S]*$/i, "")
    .trim();
  // Fall back to the first {...} block if the model wrapped it in prose.
  const candidate = cleaned.startsWith("{") ? cleaned : cleaned.match(/\{[\s\S]*\}/)?.[0] ?? "";
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}

export async function findAgentContact(
  applicationId: string,
  options?: { force?: boolean }
): Promise<{ ok: boolean; reason?: string; result?: ContactResult }> {
  const app = await prisma.planningApplication.findUnique({ where: { id: applicationId } });
  if (!app) return { ok: false, reason: "Application not found" };

  if (!options?.force && app.contactStatus === "found") {
    return { ok: true, reason: "Already researched (pass force to re-run)" };
  }
  if (!isClaudeConfigured()) return { ok: false, reason: "ANTHROPIC_API_KEY not configured" };

  const councilLine = app.councilUrl ? `\n  Council application page: ${app.councilUrl}` : "";
  const applicantLine = app.applicant ? `\n  Applicant/developer named in the feed: ${app.applicant}` : "";

  const prompt = `You are a UK property-sourcing researcher for IdealLand. We have found a London planning application and need to contact the AGENT who submitted it (usually the architect or planning consultant; sometimes the owner directly) to ask whether the owner would sell the site.

Find the agent/architect/planning consultant behind this application and their firm's contact details. Search the council's planning portal page and the web (firm websites, professional directories). Do NOT invent details — only report what you actually find.

Planning application:
  Council: ${app.council}
  Reference: ${app.reference}
  Address: ${app.address}
  Description: ${app.description}${applicantLine}${councilLine}

Return ONLY a JSON object, no prose:
{
  "agentName": "<person who filed it, or null>",
  "agentFirm": "<their company/practice, or null>",
  "agentEmail": "<contact email you found, or null>",
  "agentPhone": "<contact phone, or null>",
  "agentWebsite": "<firm website URL, or null>",
  "notes": "<one line on what you found and how confident, or where to look next>"
}`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  await prisma.planningApplication.update({
    where: { id: applicationId },
    data: { contactStatus: "researching" },
  });

  const raw = await runWithWebSearch(client, prompt);
  const parsed = raw ? parseJson<Partial<ContactResult>>(raw) : null;

  if (!parsed) {
    await prisma.planningApplication.update({
      where: { id: applicationId },
      data: { contactStatus: "not_found", contactResearchedAt: new Date() },
    });
    return { ok: false, reason: "No contact details resolved" };
  }

  const clean = (v: unknown): string | null =>
    typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : null;

  const result: ContactResult = {
    agentName: clean(parsed.agentName),
    agentFirm: clean(parsed.agentFirm),
    agentEmail: clean(parsed.agentEmail),
    agentPhone: clean(parsed.agentPhone),
    agentWebsite: clean(parsed.agentWebsite),
    notes: clean(parsed.notes),
    found: false,
  };
  // "Found" means we have something actionable to reach a human with.
  result.found = !!(result.agentEmail || result.agentName || result.agentFirm);

  await prisma.planningApplication.update({
    where: { id: applicationId },
    data: {
      agentName: result.agentName,
      agentFirm: result.agentFirm,
      agentEmail: result.agentEmail,
      agentPhone: result.agentPhone,
      agentWebsite: result.agentWebsite,
      contactNotes: result.notes,
      contactStatus: result.found ? "found" : "not_found",
      contactResearchedAt: new Date(),
    },
  });

  return { ok: true, result };
}

export async function draftApproach(
  applicationId: string,
  options?: { force?: boolean }
): Promise<{ ok: boolean; reason?: string; subject?: string; body?: string }> {
  const app = await prisma.planningApplication.findUnique({ where: { id: applicationId } });
  if (!app) return { ok: false, reason: "Application not found" };
  if (!options?.force && app.approachStatus && app.approachBody) {
    return { ok: true, reason: "Already drafted", subject: app.approachSubject ?? "", body: app.approachBody };
  }
  if (!isClaudeConfigured()) return { ok: false, reason: "ANTHROPIC_API_KEY not configured" };

  const recipient = app.agentName ?? app.agentFirm ?? "the agent";
  const firstName = app.agentName ? app.agentName.split(" ")[0] : null;
  const greetingRule = firstName
    ? `Open the email "Dear ${firstName},".`
    : `We do NOT know the recipient's name, so open with a neutral greeting like "Hello," — NEVER use a placeholder such as "[Recipient Name]", "[Name]" or brackets of any kind.`;

  const prompt = `Write a short, professional approach email on behalf of IdealLand, a London property-sourcing firm that acts for developers seeking small residential development sites (1-9 units).

Context: we saw a planning application this person (or their client) submitted, and we want to open a conversation about whether the site owner would consider SELLING the site to one of our developer clients. We are NOT selling anything and NOT offering services — we are a buyer's agent seeking off-market opportunities. Be warm, brief, and low-pressure. Do NOT invent facts, prices, or figures. Do NOT claim we already have a specific buyer lined up.

Recipient: ${recipient}${app.agentFirm ? ` (${app.agentFirm})` : ""}
The site:
  Borough: ${app.council}
  Address: ${app.address}
  Proposed scheme: ${app.description}

${greetingRule}

Return ONLY JSON:
{
  "subject": "<short, specific subject line referencing the site/borough>",
  "body": "<the email body, plain text, 90-130 words, ending with a soft question like whether the owner might be open to a conversation. Sign off as 'IdealLand'. Contains NO bracketed placeholders whatsoever.>"
}`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await withRetry(() =>
    client.messages.create({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    })
  );
  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  const parsed = parseJson<{ subject?: string; body?: string }>(text);
  if (!parsed?.subject || !parsed?.body) return { ok: false, reason: "Draft failed" };

  await prisma.planningApplication.update({
    where: { id: applicationId },
    data: {
      approachSubject: parsed.subject.trim(),
      approachBody: parsed.body.trim(),
      approachStatus: "drafted",
    },
  });

  return { ok: true, subject: parsed.subject.trim(), body: parsed.body.trim() };
}

// Run contact discovery across the best undone leads. Newest, highest-scored,
// not-yet-researched, still-open applications first.
export async function bulkFindContacts(options?: {
  minScore?: number;
  limit?: number;
}): Promise<{ processed: number; found: number; reason?: string }> {
  if (!isClaudeConfigured()) return { processed: 0, found: 0, reason: "ANTHROPIC_API_KEY not configured" };

  const minScore = options?.minScore ?? Number(process.env.CONTACT_MIN_LEAD_SCORE ?? 7);
  const limit = Math.min(options?.limit ?? 5, 25);

  const candidates = await prisma.planningApplication.findMany({
    where: { leadScore: { gte: minScore }, status: { not: "decided" }, contactStatus: null },
    orderBy: [{ leadScore: "desc" }, { submittedAt: "desc" }],
    take: limit,
    select: { id: true },
  });

  let found = 0;
  for (const c of candidates) {
    const r = await findAgentContact(c.id);
    if (r.ok && r.result?.found) found++;
  }
  return { processed: candidates.length, found };
}

const APPROACH_OUTCOMES = ["replied", "interested", "dead", "won"] as const;
export type ApproachOutcome = (typeof APPROACH_OUTCOMES)[number];

export function isApproachOutcome(v: string): v is ApproachOutcome {
  return (APPROACH_OUTCOMES as readonly string[]).includes(v);
}

// Staff sends the approach from their own email/LinkedIn, then records what
// happened here so the ROI pipeline has a measurable end.
export async function setApproachState(
  applicationId: string,
  changes: { status?: "drafted" | "sent"; outcome?: ApproachOutcome | null }
): Promise<{ ok: boolean; reason?: string }> {
  const app = await prisma.planningApplication.findUnique({ where: { id: applicationId } });
  if (!app) return { ok: false, reason: "Application not found" };

  const data: Record<string, unknown> = {};
  if (changes.status) {
    data.approachStatus = changes.status;
    if (changes.status === "sent") data.approachSentAt = new Date();
  }
  if (changes.outcome !== undefined) {
    data.approachOutcome = changes.outcome;
    data.approachOutcomeAt = changes.outcome ? new Date() : null;
  }
  if (Object.keys(data).length === 0) return { ok: false, reason: "Nothing to update" };

  await prisma.planningApplication.update({ where: { id: applicationId }, data });
  return { ok: true };
}
