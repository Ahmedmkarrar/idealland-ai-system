// AI intelligence layer for planning applications.
//
// For each PlanningApplication, Claude produces:
//   - intelligenceSummary: 2-3 sentence "why this matters" brief for a developer
//   - leadScore: 1-10 opportunity quality based on units, location, type
//   - leadScoreReason: 1-line justification of the score
//
// Cached on the row (only re-run on explicit force=true). Uses any retrieved
// planning PDFs as additional context via lib/services/pdf.ts when available.
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/client";
import { gatherPdfContextForApp } from "@/lib/services/pdf";
import { withRetry } from "@/lib/retry";

function isClaudeConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!(key && !key.includes("PLACEHOLDER"));
}

interface AnalysisResult {
  summary: string;
  score: number;
  scoreReason: string;
}

const SCHEMA_HINT = `Return JSON only, matching this shape exactly:
{
  "summary": "2-3 sentences for a London property developer explaining why THIS application matters. Reference specific facts from the description/PDF. Insider tone, not press release.",
  "score": <integer 1-10>,
  "scoreReason": "<one short clause explaining the score>"
}`;

const BRAND_CONTEXT = `IdealLand sources off-market London property opportunities for developers, architects, and investors. They monitor planning applications across London's boroughs and surface deals before agents see them. Your output is shown to IdealLand staff to help them prioritise which planning applications to act on.

IdealLand specifically targets SMALL residential schemes of 1-9 units. This is deliberate: at 10+ units a scheme triggers affordable-housing obligations (s.106 / borough policy) that developers want to avoid, so sub-threshold 1-9 unit schemes are the most attractive, deliverable deals.

Scoring rubric (1-10):
  9-10 = Prime: 6-9 units, desirable borough, clean new-build or conversion, no obvious constraints
  6-8  = Strong: 3-5 units, decent location, clear build/conversion angle
  4-5  = Average: 1-2 units, edge boroughs, or minor infill
  1-3  = Marginal: barely qualifies, peripheral, or heavily constrained (e.g. conservation/listed limits)`;

async function analyzeWithClaude(
  council: string,
  units: number,
  address: string,
  description: string,
  pdfContext: string
): Promise<AnalysisResult | null> {
  if (!isClaudeConfigured()) return null;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const documentSection = pdfContext
    ? `\n\nPLANNING DOCUMENTS (use these for specifics — only mention details actually present, never invent):\n${pdfContext}`
    : "";

  try {
    const message = await withRetry(() =>
      client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        messages: [
          {
            role: "user",
            content: `${BRAND_CONTEXT}

Planning application to analyse:
  Borough: ${council}
  Address: ${address}
  Units:   ${units}
  Description: ${description}${documentSection}

${SCHEMA_HINT}`,
          },
        ],
      })
    );

    const content = message.content[0];
    if (content.type !== "text") return null;

    // Be lenient with the JSON — strip code fences if Claude added them.
    const raw = content.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    const parsed = JSON.parse(raw) as Partial<AnalysisResult>;

    if (typeof parsed.summary !== "string" || typeof parsed.score !== "number" || typeof parsed.scoreReason !== "string") {
      return null;
    }

    const score = Math.max(1, Math.min(10, Math.round(parsed.score)));
    return {
      summary: parsed.summary.trim(),
      score,
      scoreReason: parsed.scoreReason.trim(),
    };
  } catch {
    return null;
  }
}

export async function analyzeApplication(
  applicationId: string,
  options?: { force?: boolean }
): Promise<{ ok: boolean; reason?: string; result?: AnalysisResult }> {
  const app = await prisma.planningApplication.findUnique({ where: { id: applicationId } });
  if (!app) return { ok: false, reason: "Application not found" };

  if (!options?.force && app.intelligenceSummary && app.leadScore) {
    return {
      ok: true,
      reason: "Already analyzed (pass force=true to re-run)",
      result: {
        summary: app.intelligenceSummary,
        score: app.leadScore,
        scoreReason: app.leadScoreReason ?? "",
      },
    };
  }

  if (!isClaudeConfigured()) {
    return { ok: false, reason: "ANTHROPIC_API_KEY not configured" };
  }

  const pdfContext = await gatherPdfContextForApp(app.id);
  const result = await analyzeWithClaude(app.council, app.units, app.address, app.description, pdfContext);

  if (!result) return { ok: false, reason: "Claude analysis failed" };

  await prisma.planningApplication.update({
    where: { id: applicationId },
    data: {
      intelligenceSummary: result.summary,
      leadScore: result.score,
      leadScoreReason: result.scoreReason,
      analyzedAt: new Date(),
    },
  });

  return { ok: true, result };
}

// Bulk-analyse every app that hasn't been analysed yet. Caps work to avoid
// runaway Anthropic spend on a 100-app backlog.
export async function bulkAnalyze(limit = 20): Promise<{ analyzed: number; skipped: number; reason?: string }> {
  if (!isClaudeConfigured()) {
    return { analyzed: 0, skipped: 0, reason: "ANTHROPIC_API_KEY not configured" };
  }

  const unanalyzed = await prisma.planningApplication.findMany({
    where: { OR: [{ intelligenceSummary: null }, { leadScore: null }] },
    orderBy: { submittedAt: "desc" },
    take: limit,
  });

  let analyzed = 0;
  let skipped = 0;

  for (const app of unanalyzed) {
    const r = await analyzeApplication(app.id);
    if (r.ok) analyzed++;
    else skipped++;
  }

  return { analyzed, skipped };
}
