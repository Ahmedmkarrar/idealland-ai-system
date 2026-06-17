// AI acquisition layer for HMO sourcing (Phase 3 of docs/HMO_SOURCING_SPEC.md).
//
// The register ingest (lib/services/hmo.ts) already gives every property a
// deterministic, register-only sell-likelihood score. This layer adds the part a
// human acquisitions analyst would do next:
//   - analyzeHmoProperty  → a 2-3 sentence acquisition brief + a refined 1-10
//     score that weighs portfolio context Claude can reason about
//   - draftApproachLetter → a ready-to-send direct-mail letter to the owner,
//     tuned to whether they're a company or a named individual
//
// Both cache on the HmoProperty row and no-op gracefully when ANTHROPIC_API_KEY
// is absent, exactly like lib/services/intelligence.ts for planning apps.
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/client";
import { withRetry } from "@/lib/retry";

function isClaudeConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!(key && !key.includes("PLACEHOLDER"));
}

const BRAND_CONTEXT = `IdealLand sources off-market London property for buyers who acquire HMOs (Houses in Multiple Occupation) — individually and as portfolios. This brief is shown to IdealLand staff to help them decide which HMO owners to approach about selling. The owner data comes from public council licensing registers; the goal is a discreet, professional acquisition approach (direct mail), NOT mass marketing.`;

const SCORE_RUBRIC = `Refined sell-likelihood rubric (1-10):
  9-10 = Strong portfolio landlord (5+ HMOs) and/or clear exit signal (licence lapsed, ageing individual owner). High-priority approach.
  6-8  = Owns multiple HMOs or one large HMO; company-owned so cleaner to transact. Worth a personalised approach.
  4-5  = Single licensed HMO, ordinary signals. Approach only if it fits a buyer's specific area.
  1-3  = Weak target: tiny HMO, institutional/student/HA operator, or no realistic sale angle.`;

interface AcquisitionBrief {
  summary: string;
  score: number;
  scoreReason: string;
}

interface PropertyForAi {
  propertyAddress: string;
  council: string;
  postcode: string | null;
  holderName: string | null;
  holderAddress: string | null;
  ownerType: string | null;
  portfolioSize: number;
  maxPersons: number | null;
  bedrooms: number | null;
  status: string | null;
  endDate: Date | null;
  sellLikelihood: number | null;
  sellReason: string | null;
  flags: string | null;
}

// Compact, fact-only description of the property+owner for the prompt. We never
// invent data — Claude is told to reason only from what's listed.
function describe(p: PropertyForAi): string {
  const lines = [
    `Property: ${p.propertyAddress}`,
    `Borough: ${p.council}${p.postcode ? ` (${p.postcode})` : ""}`,
    `Licence holder: ${p.holderName ?? "not named in register"}`,
    p.holderAddress ? `Holder correspondence address: ${p.holderAddress}` : null,
    `Owner type: ${p.ownerType ?? "unknown"}`,
    `Portfolio: holder appears on ${p.portfolioSize} licensed HMO${p.portfolioSize === 1 ? "" : "s"} in our data`,
    p.maxPersons != null ? `Max permitted occupants: ${p.maxPersons}` : null,
    p.bedrooms != null ? `Bedrooms: ${p.bedrooms}` : null,
    p.status ? `Licence status: ${p.status}` : null,
    p.endDate ? `Licence expiry: ${p.endDate.toLocaleDateString("en-GB")}` : null,
    p.sellReason ? `Register-only signals: ${p.sellReason}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

function newClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Strip markdown code fences Claude sometimes wraps JSON in.
function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
}

async function briefWithClaude(p: PropertyForAi): Promise<AcquisitionBrief | null> {
  if (!isClaudeConfigured()) return null;
  const client = newClient();

  const schemaHint = `Return JSON only, exactly this shape:
{
  "summary": "2-3 sentences for an IdealLand acquisitions analyst: why this owner might sell and how a buyer should think about the approach. Reference the SPECIFIC facts below (portfolio size, owner type, licence status). Discreet, insider tone — never invent details not listed.",
  "score": <integer 1-10>,
  "scoreReason": "<one short clause justifying the score>"
}`;

  try {
    const message = await withRetry(() =>
      client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: `${BRAND_CONTEXT}

${SCORE_RUBRIC}

HMO to assess:
${describe(p)}

${schemaHint}`,
          },
        ],
      })
    );

    const content = message.content[0];
    if (content.type !== "text") return null;
    const parsed = JSON.parse(stripFences(content.text)) as Partial<AcquisitionBrief>;
    if (typeof parsed.summary !== "string" || typeof parsed.score !== "number" || typeof parsed.scoreReason !== "string") {
      return null;
    }
    return {
      summary: parsed.summary.trim(),
      score: Math.max(1, Math.min(10, Math.round(parsed.score))),
      scoreReason: parsed.scoreReason.trim(),
    };
  } catch {
    return null;
  }
}

// A direct-mail approach letter. Plain text (staff print/post it), British
// English, tuned by owner type. We never fabricate a price or a fake personal
// connection — it's a clean "are you open to a conversation" letter.
async function letterWithClaude(p: PropertyForAi): Promise<string | null> {
  if (!isClaudeConfigured()) return null;
  const client = newClient();

  const isCompany = p.ownerType === "company";
  const recipient = p.holderName ?? "the owner";
  const toneNote = isCompany
    ? "Address it to the company / its directors. Businesslike, peer-to-peer; you can reference portfolio acquisition directly."
    : "Address it to a named private individual. Warm, respectful, low-pressure — no jargon, no aggressive sales language.";

  try {
    const message = await withRetry(() =>
      client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 700,
        messages: [
          {
            role: "user",
            content: `${BRAND_CONTEXT}

Write a direct-mail approach LETTER (plain text, British English) from IdealLand to the owner of a licensed HMO, asking whether they would consider selling. ${toneNote}

Rules:
- 130-200 words. Professional letterhead-style but human.
- Reference the property by its address and that you understand they hold ${p.portfolioSize > 1 ? `a number of HMOs (${p.portfolioSize} in our records)` : "this licensed HMO"}.
- Make clear there is no obligation; you act for active buyers; the conversation is confidential.
- Do NOT state or imply a specific price, valuation, or guaranteed offer.
- Do NOT invent facts about the owner. Only use what is given.
- End with a clear, soft call to action and signature block placeholder "[IdealLand — name, phone, email]".
- Output ONLY the letter body text. No preamble, no explanation, no markdown.

Owner / property facts:
Recipient: ${recipient}
${describe(p)}`,
          },
        ],
      })
    );

    const content = message.content[0];
    if (content.type !== "text") return null;
    const letter = content.text.trim();
    return letter.length > 0 ? letter : null;
  } catch {
    return null;
  }
}

export async function analyzeHmoProperty(
  propertyId: string,
  options?: { force?: boolean }
): Promise<{ ok: boolean; reason?: string; result?: AcquisitionBrief }> {
  const p = await prisma.hmoProperty.findUnique({ where: { id: propertyId } });
  if (!p) return { ok: false, reason: "HMO not found" };

  if (!options?.force && p.intelligenceSummary && p.aiScore) {
    return {
      ok: true,
      reason: "Already analyzed (pass force=true to re-run)",
      result: { summary: p.intelligenceSummary, score: p.aiScore, scoreReason: p.sellReason ?? "" },
    };
  }

  if (!isClaudeConfigured()) return { ok: false, reason: "ANTHROPIC_API_KEY not configured" };

  const result = await briefWithClaude(p as PropertyForAi);
  if (!result) return { ok: false, reason: "Claude analysis failed" };

  await prisma.hmoProperty.update({
    where: { id: propertyId },
    data: { intelligenceSummary: result.summary, aiScore: result.score, analyzedAt: new Date() },
  });

  return { ok: true, result };
}

export async function draftApproachLetter(
  propertyId: string,
  options?: { force?: boolean }
): Promise<{ ok: boolean; reason?: string; letter?: string }> {
  const p = await prisma.hmoProperty.findUnique({ where: { id: propertyId } });
  if (!p) return { ok: false, reason: "HMO not found" };

  if (p.ownerType === "institutional") {
    return { ok: false, reason: "Institutional/student operator — not a private-sale target, no letter drafted" };
  }

  if (!options?.force && p.approachLetter) {
    return { ok: true, reason: "Already drafted (pass force=true to re-run)", letter: p.approachLetter };
  }

  if (!isClaudeConfigured()) return { ok: false, reason: "ANTHROPIC_API_KEY not configured" };

  const letter = await letterWithClaude(p as PropertyForAi);
  if (!letter) return { ok: false, reason: "Claude draft failed" };

  await prisma.hmoProperty.update({
    where: { id: propertyId },
    data: { approachLetter: letter, approachStatus: "draft", letterDraftedAt: new Date() },
  });

  return { ok: true, letter };
}

// Bulk-analyse the highest deterministic-scoring properties that Claude hasn't
// seen yet. Caps work to protect Anthropic spend; targets the best leads first
// so a single run produces a usable shortlist for James.
export async function bulkAnalyzeHmo(limit = 25): Promise<{ analyzed: number; skipped: number; reason?: string }> {
  if (!isClaudeConfigured()) {
    return { analyzed: 0, skipped: 0, reason: "ANTHROPIC_API_KEY not configured" };
  }

  const pending = await prisma.hmoProperty.findMany({
    where: { intelligenceSummary: null, ownerType: { not: "institutional" } },
    orderBy: [{ sellLikelihood: "desc" }, { portfolioSize: "desc" }],
    take: limit,
  });

  let analyzed = 0;
  let skipped = 0;
  for (const p of pending) {
    const r = await analyzeHmoProperty(p.id);
    if (r.ok && r.result) analyzed++;
    else skipped++;
  }

  return { analyzed, skipped };
}
