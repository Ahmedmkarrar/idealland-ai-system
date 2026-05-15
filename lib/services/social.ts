import { prisma } from "@/lib/db/client";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { withRetry } from "@/lib/retry";

const PLATFORMS = ["instagram", "linkedin", "tiktok", "facebook"] as const;

function isClaudeConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!(key && !key.includes("PLACEHOLDER"));
}

function isAyrshareConfigured(): boolean {
  const key = process.env.AYRSHARE_API_KEY;
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
  description: string
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

Write a post that positions IdealLand as the intelligent early-mover advantage for developers. Make it feel like insider intelligence, not a press release.
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

async function generateImageWithDalle(units: number, location: string): Promise<string | null> {
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
      })
    );

    return response.data?.[0]?.url ?? null;
  } catch {
    return null;
  }
}

async function isImageUrlAccessible(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function publishToAyrshare(
  platform: string,
  content: string,
  imageUrl?: string | null
): Promise<{ success: boolean; postId?: string }> {
  if (!isAyrshareConfigured()) return { success: false };

  const platformMap: Record<string, string> = {
    instagram: "instagram",
    linkedin: "linkedin",
    tiktok: "tiktok",
    facebook: "facebook",
  };

  try {
    const response = await withRetry(() =>
      fetch("https://app.ayrshare.com/api/post", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.AYRSHARE_API_KEY}`,
        },
        body: JSON.stringify({
          post: content,
          platforms: [platformMap[platform]],
          ...(imageUrl && { mediaUrls: [imageUrl] }),
        }),
      })
    );

    if (!response.ok) return { success: false };
    const data = (await response.json()) as { id?: string };
    return { success: true, postId: data.id };
  } catch {
    return { success: false };
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

      const imageUrl = await generateImageWithDalle(app.units, app.council);
      const imageGeneratedAt = imageUrl ? new Date() : null;

      for (const platform of PLATFORMS) {
        const alreadyHas = await prisma.socialPost.findFirst({
          where: { applicationId: app.id, platform },
        });
        if (alreadyHas) { skipped++; continue; }

        const content = await generateContentWithClaude(platform, app.units, app.council, app.description);
        if (!content) {
          skipped++;
          continue;
        }

        const scheduledAt = new Date(Date.now() + Math.random() * 48 * 60 * 60 * 1000);
        await prisma.socialPost.create({
          data: {
            platform,
            content,
            imageUrl: imageUrl ?? null,
            imageGeneratedAt,
            status: "draft",
            approvalStatus: "pending_review",
            scheduledAt,
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
        summary: `Generated ${generated} posts via Claude AI.${imageNote} ${skipped > 0 ? `${skipped} skipped.` : ""}`,
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

const DALL_E_URL_EXPIRY_MS = 55 * 60 * 1000;

export async function publishScheduledPosts(): Promise<{
  published: number;
  failed: number;
  reason?: string;
}> {
  if (!isAyrshareConfigured()) {
    return { published: 0, failed: 0, reason: "AYRSHARE_API_KEY not configured" };
  }

  const duePosts = await prisma.socialPost.findMany({
    where: { status: "scheduled", scheduledAt: { lte: new Date() } },
    include: { application: true },
  });

  let published = 0;
  let failed = 0;

  for (const post of duePosts) {
    let imageUrl: string | null = post.imageUrl;

    if (imageUrl && post.imageGeneratedAt) {
      const imageAgeMs = Date.now() - new Date(post.imageGeneratedAt).getTime();
      const isExpired = imageAgeMs > DALL_E_URL_EXPIRY_MS;

      if (isExpired) {
        const canRegenerate = isOpenAiConfigured() && post.application;
        const freshUrl = canRegenerate
          ? await generateImageWithDalle(post.application!.units, post.application!.council)
          : null;

        imageUrl = freshUrl;

        if (freshUrl) {
          await prisma.socialPost.update({
            where: { id: post.id },
            data: { imageUrl: freshUrl, imageGeneratedAt: new Date() },
          });
        } else {
          await prisma.socialPost.update({ where: { id: post.id }, data: { imageUrl: null } });
        }
      } else {
        const isAccessible = await isImageUrlAccessible(imageUrl);
        if (!isAccessible) imageUrl = null;
      }
    }

    const result = await publishToAyrshare(post.platform, post.content, imageUrl);
    await prisma.socialPost.update({
      where: { id: post.id },
      data: {
        status: result.success ? "published" : "failed",
        publishedAt: result.success ? new Date() : null,
      },
    });
    result.success ? published++ : failed++;
  }

  return { published, failed };
}

export async function syncEngagementMetrics(): Promise<{ updated: number }> {
  if (!isAyrshareConfigured()) return { updated: 0 };

  const publishedPosts = await prisma.socialPost.findMany({
    where: { status: "published", publishedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    take: 50,
  });

  let updated = 0;

  for (const post of publishedPosts) {
    try {
      const response = await withRetry(() =>
        fetch(`https://app.ayrshare.com/api/analytics/post?id=${post.id}&platforms=${post.platform}`, {
          headers: { Authorization: `Bearer ${process.env.AYRSHARE_API_KEY}` },
        })
      );
      if (!response.ok) continue;

      type AyrshareAnalytics = {
        analytics?: Array<{ likes?: number; comments?: number; shares?: number; impressions?: number }>;
      };
      const data = (await response.json()) as AyrshareAnalytics;
      const row = data.analytics?.[0];
      if (!row) continue;

      const engagements = (row.likes ?? 0) + (row.comments ?? 0) + (row.shares ?? 0);
      await prisma.socialPost.update({
        where: { id: post.id },
        data: { engagements, reach: row.impressions ?? 0 },
      });
      updated++;
    } catch {
      // Non-fatal: continue to next post
    }
  }

  return { updated };
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
