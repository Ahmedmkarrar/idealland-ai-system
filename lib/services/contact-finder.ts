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
import { usableEmail } from "@/lib/email-address";
import { councilReference } from "@/lib/planning-portals";
import { timeGreeting } from "@/lib/approach-email";

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
  // The council's own reference is the one that appears on the planning portal and
  // in the application documents, so it's the one a web search can actually hit.
  // `app.reference` is a GLA document id that exists nowhere outside our database —
  // searching for it returns nothing, which quietly cost us hit rate.
  const searchableRef = councilReference(app) ?? app.reference;

  const prompt = `You are a UK property-sourcing researcher for IdealLand. We have found a London planning application and need to contact the AGENT who submitted it (usually the architect or planning consultant; sometimes the owner directly) to ask whether the owner would sell the site.

Find the agent/architect/planning consultant behind this application and their firm's contact details. Search the council's planning portal page and the web (firm websites, professional directories). Do NOT invent details — only report what you actually find.

Planning application:
  Council: ${app.council}
  Council reference: ${searchableRef}
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

  const rawEmail = clean(parsed.agentEmail);
  const { email: agentEmail, rejected: rejectedEmail } = usableEmail(rawEmail);

  const result: ContactResult = {
    agentName: clean(parsed.agentName),
    agentFirm: clean(parsed.agentFirm),
    agentEmail,
    agentPhone: clean(parsed.agentPhone),
    agentWebsite: clean(parsed.agentWebsite),
    notes: clean(parsed.notes),
    found: false,
  };
  // A guessed pattern isn't a contact — surface it as a lead to chase, never as a
  // one-click send, or Lucy mails an address that bounces.
  if (rejectedEmail) {
    result.notes = [
      result.notes,
      `Unverified email pattern returned ("${rejectedEmail}") — not a confirmed address. Identify the individual before sending.`,
    ]
      .filter(Boolean)
      .join(" ");
  }
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

// IdealLand's outbound identity in the seller-approach email.
//
// Approaches go out signed by James, at Lucy's request — she is cc'd on every one
// (see the mailto builders in the Sourcing and Ready pages) so she keeps a record
// without being the name on the letter.
//
// The letter no longer prints a phone number: Lucy sends it from her own mailbox
// and offers to set up the call, so there is nothing to publish for James in a
// cold email. IDEALLAND_SENDER_NAME overrides the name in the sign-off.
const SENDER_NAME = process.env.IDEALLAND_SENDER_NAME ?? "James";
const IDEALLAND_WEBSITE = process.env.IDEALLAND_WEBSITE ?? "www.idealland.co.uk";

// A first name is only safe as a greeting when it's a single clean person. Two
// agents joined by "/" or a comma-separated list get the time-of-day greeting.
function greeting(agentName: string | null): string {
  if (!agentName || /[/,&]/.test(agentName)) return timeGreeting();
  const first = agentName.trim().split(/\s+/)[0];
  return first ? `Dear ${first},` : timeGreeting();
}

function unitPhrase(units: number): string {
  return `${units} residential ${units === 1 ? "unit" : "units"}`;
}

/**
 * Lucy's wording (2026-08-07). She sends the letter herself and books the call,
 * so it offers to arrange one rather than printing a direct line — which also
 * removes the need to publish a number for James in a cold email.
 */
function chatOffer(): string {
  return `If you would prefer to have a chat please let me know and I will set up a phone call with ${SENDER_NAME}.`;
}

// Lucy's own templates, verbatim in structure (supplied 2026-07-25), with the
// site specifics slotted in from our structured fields. Two scenarios: a site
// that already HAS planning permission (status "decided") vs one still SEEKING it.
// Deterministic on purpose — this is her voice, so no paraphrasing / no LLM.
/**
 * Only an explicit grant earns the "you have received planning permission" letter.
 *
 * `status === "decided"` means the council reached a decision, not that it said
 * yes — about a quarter of decided applications in the London feed are refusals,
 * with withdrawals and lapses beyond that. Congratulating an agent on a permission
 * their client was refused is the kind of mistake that ends the conversation, so
 * anything that isn't a clear approval gets the neutral letter instead. A refused
 * applicant is often the more willing seller anyway.
 */
function isApproval(decision: string | null | undefined): boolean {
  if (!decision) return false;
  const d = decision.trim().toLowerCase();
  if (/refus|reject|withdraw|lapsed|declined|closed|not required/.test(d)) return false;
  return /approv|grant|permit|consent|allowed/.test(d);
}

function buildApproachEmail(app: {
  agentName: string | null;
  units: number;
  address: string;
  council: string;
  status: string;
  decision: string | null;
}): { subject: string; body: string } {
  const hasPlanning = app.status === "decided" && isApproval(app.decision);
  const open = greeting(app.agentName);

  if (hasPlanning) {
    return {
      subject: `Planning permission – ${app.address}`,
      body: `${open}

I hope you are well.

I noticed from the planning register that you have received planning permission to construct ${unitPhrase(app.units)} at ${app.address}.

Are you planning on selling the site or building it out yourself?

If not, I have several clients who would be interested in buying the site. We specialise in finding off market sites for developers, builders and architects with or without planning permission. Our services are completely free as we are retained by our purchasers. Please see our website for a snapshot of our retained clients and recent work at ${IDEALLAND_WEBSITE}.

${chatOffer()}

Best wishes
${SENDER_NAME}`,
    };
  }

  return {
    subject: `Your application at ${app.address}`,
    body: `${open}

I came across the application at ${app.address} for ${unitPhrase(app.units)}.

I just wanted to ask — is your client planning to build it out, or would they consider a sale?

We are currently working with a number of developers actively acquiring similar schemes in ${app.council} and are retained by them, so there's no fee to your client. We are also happy to discuss an introduction fee with you.

${chatOffer()}

Best wishes
${SENDER_NAME}`,
  };
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

  const { subject, body } = buildApproachEmail({
    agentName: app.agentName,
    units: app.units,
    address: app.address,
    council: app.council,
    status: app.status,
    decision: app.decision,
  });

  await prisma.planningApplication.update({
    where: { id: applicationId },
    data: {
      approachSubject: subject,
      approachBody: body,
      approachStatus: "drafted",
    },
  });

  return { ok: true, subject, body };
}

// Run contact discovery across the best undone leads. Newest, highest-scored,
// not-yet-researched, still-open applications first.
export async function bulkFindContacts(options?: {
  minScore?: number;
  limit?: number;
  autoDraft?: boolean;
}): Promise<{ processed: number; found: number; drafted: number; reason?: string }> {
  if (!isClaudeConfigured()) return { processed: 0, found: 0, drafted: 0, reason: "ANTHROPIC_API_KEY not configured" };

  const minScore = options?.minScore ?? Number(process.env.CONTACT_MIN_LEAD_SCORE ?? 7);
  const limit = Math.min(options?.limit ?? 5, 40);
  const autoDraft = options?.autoDraft ?? false;

  // publicOwner excluded: researching land the council already owns spends real
  // money (a Claude call plus web searches) on a site that can never be brokered.
  const base = {
    leadScore: { gte: minScore },
    status: { not: "decided" },
    contactStatus: null,
    publicOwner: false,
  } as const;
  const order = [{ leadScore: "desc" as const }, { submittedAt: "desc" as const }];

  // A council portal link is the finder's strongest signal (it confirms the
  // application and often names the agent), so spend the budget on those leads
  // first, then backfill with link-less leads to use any remaining slots.
  const withUrl = await prisma.planningApplication.findMany({
    where: { ...base, councilUrl: { not: null } },
    orderBy: order,
    take: limit,
    select: { id: true },
  });
  const remaining = limit - withUrl.length;
  const withoutUrl = remaining > 0
    ? await prisma.planningApplication.findMany({
        where: { ...base, councilUrl: null },
        orderBy: order,
        take: remaining,
        select: { id: true },
      })
    : [];
  const candidates = [...withUrl, ...withoutUrl];

  let found = 0;
  let drafted = 0;
  for (const c of candidates) {
    const r = await findAgentContact(c.id);
    if (r.ok && r.result?.found) {
      found++;
      if (autoDraft) {
        const d = await draftApproach(c.id);
        if (d.ok) drafted++;
      }
    }
  }
  return { processed: candidates.length, found, drafted };
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
