import { prisma } from "@/lib/db/client";
import { withRetry } from "@/lib/retry";
import Anthropic from "@anthropic-ai/sdk";

const META_API_VERSION = "v21.0";
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

function isMetaConfigured(): boolean {
  const token = process.env.META_ACCESS_TOKEN;
  const adAccount = process.env.META_AD_ACCOUNT_ID;
  return !!(
    token &&
    adAccount &&
    !token.includes("PLACEHOLDER") &&
    !adAccount.includes("PLACEHOLDER")
  );
}

async function metaPost(
  path: string,
  body: Record<string, unknown>
): Promise<{ id?: string; success?: boolean } | null> {
  try {
    const response = await withRetry(() =>
      fetch(`${META_BASE}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, access_token: process.env.META_ACCESS_TOKEN }),
        signal: AbortSignal.timeout(10000),
      })
    );
    if (!response.ok) return null;
    return (await response.json()) as { id?: string; success?: boolean };
  } catch {
    return null;
  }
}

async function metaGet<T>(path: string): Promise<T | null> {
  try {
    const separator = path.includes("?") ? "&" : "?";
    const url = `${META_BASE}/${path}${separator}access_token=${process.env.META_ACCESS_TOKEN}`;
    const response = await withRetry(() =>
      fetch(url, { signal: AbortSignal.timeout(10000) })
    );
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function isClaudeConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!(key && !key.includes("PLACEHOLDER"));
}

function isPageConfigured(): boolean {
  return !!(process.env.META_PAGE_ID && !process.env.META_PAGE_ID.includes("PLACEHOLDER"));
}

// London city targeting key for Meta API
const LONDON_GEO_TARGETING = {
  cities: [{ key: "2643743", name: "London", country: "GB", region: "England", region_id: "546" }],
};

const ARCHITECT_INTERESTS = [
  { id: "6003409910735", name: "Architecture" },
  { id: "6003487650735", name: "Real estate" },
  { id: "6003334013735", name: "Property management" },
  { id: "6003177549735", name: "Construction" },
  { id: "6003439452735", name: "Urban planning" },
];

async function generateAdCopy(platform: string): Promise<{ headline: string; body: string }> {
  if (!isClaudeConfigured()) {
    return {
      headline: "Discover London Land Opportunities First",
      body: "IdealLand monitors every London borough daily. Be first to identify 10+ unit residential developments before they hit the market. Built for architects and developers.",
    };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const message = await withRetry(() =>
      client.messages.create({
        model: "claude-haiku-4-5-20251001" as string,
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: `Write a ${platform} ad for IdealLand, a London land sourcing company that monitors planning applications daily and alerts developers and architects to opportunities early.

Return JSON only: {"headline": "max 40 chars", "body": "max 125 chars, no emojis, professional"}

Target: London architects and property developers aged 25-55.
Angle: early intelligence, competitive advantage, never miss a deal.`,
          },
        ],
      })
    );
    const text = message.content[0];
    if (text.type !== "text") throw new Error("Unexpected response");
    const parsed = JSON.parse(text.text.trim()) as { headline: string; body: string };
    return parsed;
  } catch {
    return {
      headline: "London Land Opportunities — First",
      body: "IdealLand identifies 10+ unit residential planning applications before the market. Get the intelligence edge.",
    };
  }
}

async function createMetaAdSet(
  metaCampaignId: string,
  dailyBudgetPence: number,
  platform: "instagram" | "facebook"
): Promise<string | null> {
  const placement =
    platform === "instagram"
      ? { instagram_positions: ["stream", "explore"], publisher_platforms: ["instagram"] }
      : { facebook_positions: ["feed", "right_hand_column"], publisher_platforms: ["facebook"] };

  const result = await metaPost(`${process.env.META_AD_ACCOUNT_ID}/adsets`, {
    name: `IdealLand ${platform} Ad Set`,
    campaign_id: metaCampaignId,
    daily_budget: dailyBudgetPence,
    billing_event: "IMPRESSIONS",
    optimization_goal: "REACH",
    bid_amount: 200,
    targeting: {
      geo_locations: LONDON_GEO_TARGETING,
      age_min: 25,
      age_max: 55,
      interests: ARCHITECT_INTERESTS,
      ...placement,
    },
    status: "PAUSED",
  });

  return result?.id ?? null;
}

async function createMetaAdCreative(
  headline: string,
  body: string,
  imageUrl?: string
): Promise<string | null> {
  if (!isPageConfigured()) return null;

  const linkData: Record<string, unknown> = {
    link: process.env.META_WEBSITE_URL ?? "https://idealland.co.uk",
    message: body,
    name: headline,
    call_to_action: { type: "LEARN_MORE" },
  };

  if (imageUrl) linkData.picture = imageUrl;

  const result = await metaPost(`${process.env.META_AD_ACCOUNT_ID}/adcreatives`, {
    name: "IdealLand Ad Creative",
    object_story_spec: {
      page_id: process.env.META_PAGE_ID,
      link_data: linkData,
    },
  });

  return result?.id ?? null;
}

async function createMetaAd(
  adSetId: string,
  creativeId: string,
  campaignName: string
): Promise<string | null> {
  const result = await metaPost(`${process.env.META_AD_ACCOUNT_ID}/ads`, {
    name: `${campaignName} — Ad`,
    adset_id: adSetId,
    creative: { creative_id: creativeId },
    status: "PAUSED",
  });

  return result?.id ?? null;
}

interface CampaignConfig {
  name: string;
  platform: "instagram" | "facebook";
  budget: number;
  targetAudience: string[];
  imageUrl?: string;
  startDate?: Date;
  endDate?: Date;
}

export async function createCampaign(
  config: CampaignConfig
): Promise<{ campaignId: string; reason?: string }> {
  if (!isMetaConfigured()) {
    const campaign = await prisma.adCampaign.create({
      data: {
        name: config.name,
        platform: config.platform,
        status: "draft",
        budget: config.budget,
        targeting: JSON.stringify({ audiences: config.targetAudience, locations: ["London"] }),
        startDate: config.startDate,
        endDate: config.endDate,
      },
    });
    return {
      campaignId: campaign.id,
      reason: "META_ACCESS_TOKEN not configured — campaign saved locally only",
    };
  }

  const runRecord = await prisma.automationRun.create({
    data: { type: "ads", status: "running" },
  });

  try {
    // 1. Campaign
    const metaCampaign = await metaPost(`${process.env.META_AD_ACCOUNT_ID}/campaigns`, {
      name: config.name,
      objective: "OUTCOME_AWARENESS",
      status: "PAUSED",
      special_ad_categories: [],
    });

    // 2. Ad Set
    const dailyBudgetPence = Math.round((config.budget / 30) * 100);
    const adSetId = metaCampaign?.id
      ? await createMetaAdSet(metaCampaign.id, dailyBudgetPence, config.platform)
      : null;

    // 3. Ad Creative (with Claude-generated copy)
    const { headline, body } = await generateAdCopy(config.platform);
    const creativeId = adSetId
      ? await createMetaAdCreative(headline, body, config.imageUrl)
      : null;

    // 4. Ad
    const adId = adSetId && creativeId
      ? await createMetaAd(adSetId, creativeId, config.name)
      : null;

    const metaDetails = {
      metaCampaignId: metaCampaign?.id,
      metaAdSetId: adSetId,
      metaCreativeId: creativeId,
      metaAdId: adId,
    };

    const campaign = await prisma.adCampaign.create({
      data: {
        name: config.name,
        platform: config.platform,
        status: "draft",
        budget: config.budget,
        targeting: JSON.stringify({
          audiences: config.targetAudience,
          locations: ["London"],
          ageRange: { min: 25, max: 55 },
          interests: ["architecture", "property development", "real estate", "construction"],
          adCopy: { headline, body },
          ...metaDetails,
        }),
        startDate: config.startDate,
        endDate: config.endDate,
      },
    });

    const structureNote = adId
      ? "Campaign → AdSet → Creative → Ad created"
      : metaCampaign?.id
        ? `Campaign created (ID: ${metaCampaign.id}). AdSet/Creative skipped — META_PAGE_ID needed`
        : "Saved locally only (Meta API credentials needed)";

    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        summary: `Campaign "${config.name}" for ${config.platform}. ${structureNote}.`,
      },
    });

    return { campaignId: campaign.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: { status: "failed", completedAt: new Date(), error: message },
    });
    throw error;
  }
}

function parseTargeting(raw: string): Record<string, string | undefined> {
  try {
    return JSON.parse(raw) as Record<string, string | undefined>;
  } catch {
    return {};
  }
}

export async function activateCampaign(campaignId: string): Promise<void> {
  const campaign = await prisma.adCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return;

  if (isMetaConfigured()) {
    const t = parseTargeting(campaign.targeting);
    if (t.metaCampaignId) await metaPost(t.metaCampaignId, { status: "ACTIVE" });
    if (t.metaAdSetId) await metaPost(t.metaAdSetId, { status: "ACTIVE" });
    if (t.metaAdId) await metaPost(t.metaAdId, { status: "ACTIVE" });
  }

  await prisma.adCampaign.update({
    where: { id: campaignId },
    data: { status: "active", startDate: new Date() },
  });
}

export async function pauseCampaign(campaignId: string): Promise<void> {
  const campaign = await prisma.adCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return;

  if (isMetaConfigured()) {
    const t = parseTargeting(campaign.targeting);
    if (t.metaAdId) await metaPost(t.metaAdId, { status: "PAUSED" });
    if (t.metaAdSetId) await metaPost(t.metaAdSetId, { status: "PAUSED" });
    if (t.metaCampaignId) await metaPost(t.metaCampaignId, { status: "PAUSED" });
  }

  await prisma.adCampaign.update({ where: { id: campaignId }, data: { status: "paused" } });
}

export async function refreshCampaignMetrics(): Promise<void> {
  if (!isMetaConfigured()) return;

  const activeCampaigns = await prisma.adCampaign.findMany({ where: { status: "active" } });

  for (const campaign of activeCampaigns) {
    const targeting = parseTargeting(campaign.targeting);
    const metaCampaignId = targeting.metaCampaignId;
    if (!metaCampaignId) continue;

    type InsightsResponse = {
      data?: Array<{ impressions?: string; clicks?: string; spend?: string }>;
    };
    const insights = await metaGet<InsightsResponse>(
      `${metaCampaignId}/insights?fields=impressions,clicks,spend`
    );

    const row = insights?.data?.[0];
    if (!row) continue;

    await prisma.adCampaign.update({
      where: { id: campaign.id },
      data: {
        impressions: parseInt(row.impressions ?? "0", 10),
        clicks: parseInt(row.clicks ?? "0", 10),
        spent: Math.min(campaign.budget, parseFloat(row.spend ?? "0")),
        status: parseFloat(row.spend ?? "0") >= campaign.budget ? "completed" : "active",
      },
    });
  }
}

export async function getCampaigns(filters?: { platform?: string; status?: string }) {
  return prisma.adCampaign.findMany({
    where: {
      ...(filters?.platform && { platform: filters.platform }),
      ...(filters?.status && { status: filters.status }),
    },
    orderBy: { createdAt: "desc" },
  });
}
