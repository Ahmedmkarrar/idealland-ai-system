// Social content factory — DRAFT-ONLY mode.
//
// We do NOT publish to any third-party social vendor (Ayrshare, PostingCat, etc.).
// Decision: 2026-05-31, "keep it simple, just going" — IdealLand staff copy
// approved drafts from /social dashboard and post manually.
//
// What this file does:
//   - generateAndSchedulePosts(): Claude drafts per-platform copy, DALL-E generates
//     an optional image, posts are stored with status="draft", approvalStatus="pending_review".
//   - getSocialPosts(): list/filter for the dashboard.
//
// What it does NOT do (intentionally):
//   - No publishScheduledPosts(): the dashboard surfaces approved drafts; humans copy/paste.
//   - No syncEngagementMetrics(): nothing to sync without a publisher integration.
import { prisma } from "@/lib/db/client";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { withRetry } from "@/lib/retry";
import { gatherPdfContextForApp } from "@/lib/services/pdf";
import { persistImage } from "@/lib/services/images";

const PLATFORMS = ["instagram", "linkedin", "tiktok", "facebook"] as const;

function isClaudeConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!(key && !key.includes("PLACEHOLDER"));
}

function isOpenAiConfigured(): boolean {
  const key = process.env.OPENAI_API_KEY;
  return !!(key && !key.includes("PLACEHOLDER"));
}

async function generateContentWithClaude(
  platform: string,
  units: number,
  location: string,
  description: string,
  pdfContext?: string
): Promise<string | null> {
  if (!isClaudeConfigured()) return null;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const platformGuidance: Record<string, string> = {
    instagram: "casual, visual, emoji-friendly, 150-220 chars, 3-5 hashtags",
    linkedin: "professional, authoritative, no emojis, 200-300 chars, 2-3 hashtags",
    tiktok: "energetic, punchy, trending style, 100-150 chars, 4-6 hashtags",
    facebook: "conversational, informative, 150-250 chars, 2-4 hashtags",
  };

  const brandContext = `
IdealLand is a London-based land sourcing company. We identify planning applications early — before agents or the market — and connect developers and architects with the right opportunities at the right time.
Brand voice: proactive, expert, opportunity-focused. We speak the language of developers and architects. Never salesy. Always intelligence-led.
Our edge: we monitor every London borough daily so clients never miss a deal.
Target audience: London-based property developers, architects, and investors.`;

  const documentSection = pdfContext
    ? `

PLANNING DOCUMENTS (use these for specifics — only mention details actually present below, never invent):
${pdfContext}

`
    : "";

  try {
    const message = await withRetry(() =>
      client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: `You write social media content for IdealLand.

${brandContext}

Platform: ${platform} (style: ${platformGuidance[platform] ?? "engaging, professional"})
New planning application just identified: ${units}-unit residential development in ${location}
Description: ${description}
${documentSection}
Write a post that positions IdealLand as the intelligent early-mover advantage for developers. Make it feel like insider intelligence, not a press release. ${pdfContext ? "Pull one concrete detail from the planning documents above to make the post specific and credible." : ""}
Write ONLY the post text. No quotes, no labels, no explanation.`,
          },
        ],
      })
    );

    const content = message.content[0];
    return content.type === "text" ? content.text.trim() : null;
  } catch {
    return null;
  }
}

interface GeneratedImage {
  // Filename in our own storage — this is what the dashboard renders.
  path: string;
  // OpenAI's URL, kept for provenance. Expires after ~1 hour; never render it.
  url: string | null;
}

// Asks DALL-E for the raw bytes (response_format: "b64_json") rather than the
// default URL, which expires after ~1 hour and would leave every post older
// than that pointing at nothing. We persist our own copy immediately.
async function generateImageWithDalle(units: number, location: string): Promise<GeneratedImage | null> {
  if (!isOpenAiConfigured()) return null;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const response = await withRetry(() =>
      client.images.generate({
        model: "dall-e-3",
        prompt: `Professional architectural visualization of a modern ${units}-unit residential development in ${location}, London. Clean contemporary design, photorealistic render, daylight, urban setting. No text or labels.`,
        n: 1,
        size: "1024x1024",
        quality: "standard",
        response_format: "b64_json",
      })
    );

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) return null;

    const stored = await persistImage(Buffer.from(b64, "base64"));
    if (!stored) return null;

    return { path: stored, url: response.data?.[0]?.url ?? null };
  } catch {
    return null;
  }
}

export async function generateAndSchedulePosts(
  applicationId?: string
): Promise<{ generated: number; skipped: number; reason?: string }> {
  if (!isClaudeConfigured()) {
    return { generated: 0, skipped: PLATFORMS.length, reason: "ANTHROPIC_API_KEY not configured" };
  }

  const runRecord = await prisma.automationRun.create({
    data: { type: "social", status: "running" },
  });

  try {
    let generated = 0;
    let skipped = 0;

    const applications = applicationId
      ? await prisma.planningApplication.findMany({ where: { id: applicationId } })
      : await prisma.planningApplication.findMany({ orderBy: { createdAt: "desc" }, take: 3 });

    if (applications.length === 0) {
      await prisma.automationRun.update({
        where: { id: runRecord.id },
        data: { status: "completed", completedAt: new Date(), summary: "No applications to generate content for." },
      });
      return { generated: 0, skipped: 0 };
    }

    for (const app of applications) {
      const existingPostCount = await prisma.socialPost.count({
        where: { applicationId: app.id },
      });
      if (existingPostCount >= PLATFORMS.length) continue;

      // Pull text from the application's planning PDFs once per app, reuse
      // across all four platforms. Falls back to "" if nothing extractable —
      // generateContentWithClaude handles missing context cleanly.
      const pdfContext = await gatherPdfContextForApp(app.id);

      // One image per application, reused across all four platform posts.
      const image = await generateImageWithDalle(app.units, app.council);
      const imageGeneratedAt = image ? new Date() : null;

      for (const platform of PLATFORMS) {
        const alreadyHas = await prisma.socialPost.findFirst({
          where: { applicationId: app.id, platform },
        });
        if (alreadyHas) { skipped++; continue; }

        const content = await generateContentWithClaude(platform, app.units, app.council, app.description, pdfContext || undefined);
        if (!content) {
          skipped++;
          continue;
        }

        await prisma.socialPost.create({
          data: {
            platform,
            content,
            imageUrl: image?.url ?? null,
            imagePath: image?.path ?? null,
            imageGeneratedAt,
            status: "draft",
            approvalStatus: "pending_review",
            applicationId: app.id,
          },
        });
        generated++;
      }
    }

    const imageNote = isOpenAiConfigured() ? "" : " No images (OPENAI_API_KEY not set).";
    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        summary: `Generated ${generated} posts via Claude AI (PDF-aware).${imageNote} ${skipped > 0 ? `${skipped} skipped.` : ""}`,
      },
    });

    return { generated, skipped };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: { status: "failed", completedAt: new Date(), error: message },
    });
    throw error;
  }
}

export async function getSocialPosts(filters?: { platform?: string; status?: string }) {
  return prisma.socialPost.findMany({
    where: {
      ...(filters?.platform && { platform: filters.platform }),
      ...(filters?.status && { status: filters.status }),
    },
    orderBy: { createdAt: "desc" },
  });
}
