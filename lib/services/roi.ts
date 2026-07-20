// ROI snapshot — turns the system's activity into a single, defensible "money
// view" the client can look at and immediately see the return.
//
// Two kinds of ROI:
//   1. Hard ROI  — labour + software the system replaces. Real every month,
//      independent of whether any deal closes. Cost-substitution.
//   2. Deal ROI  — sourcing/finder fees from opportunities the outreach engine
//      turns into conversations and deals. Probability-weighted pipeline plus
//      confirmed (closed-won) value.
//
// Every money assumption is a named constant, env-overridable, and surfaced to
// the UI so the numbers are transparent rather than magic.
import { prisma } from "@/lib/db/client";

function num(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

// --- Hard ROI assumptions (cost substitution) ---
const HOURS_SAVED_PER_MONTH = num("ROI_HOURS_SAVED", 115); // manual sourcing/outreach/admin hours replaced
const HOURLY_RATE = num("ROI_HOURLY_RATE", 25); // £/hr blended cost of the labour replaced
const TOOLS_REPLACED_MONTHLY = num("ROI_TOOLS_REPLACED", 600); // PropertyData + Mailshake + Hootsuite + HubSpot-equiv
const RUNNING_COST_MONTHLY = num("ROI_RUNNING_COST", 50); // droplet + Anthropic + OpenAI + Resend

// --- Deal ROI assumptions ---
const SOURCING_FEE = num("ROI_SOURCING_FEE", 5000); // avg fee per completed sourced deal (£)
const INTEREST_WIN_PROB = num("ROI_INTEREST_WIN_PROB", 0.3); // P(interested lead → deal)
const REPLY_WIN_PROB = num("ROI_REPLY_WIN_PROB", 0.1); // P(replied-only lead → deal)

const PRIME_SCORE = 8; // 8-10 = prime
const STRONG_SCORE = 6; // 6+ = strong

type OutcomeTier = "closed-won" | "interested" | "replied" | "dead";

// Best outcome wins so a single deal with five emails counts once, at its
// furthest-along stage — not five times, and not double-counted across tiers.
const TIER_RANK: Record<OutcomeTier, number> = {
  "closed-won": 4,
  interested: 3,
  replied: 2,
  dead: 1,
};

export interface RoiSnapshot {
  generatedAt: string;
  hard: {
    hoursSaved: number;
    labourValue: number;
    toolsReplaced: number;
    runningCost: number;
    netMonthly: number;
    netAnnual: number;
  };
  funnel: {
    leadsSourced: number;
    leadsScored: number;
    primeLeads: number; // score 8+
    strongLeads: number; // score 6+
    appsWithDrafts: number;
    emailsDrafted: number;
    emailsSent: number;
    appsContacted: number;
    replied: number; // apps, best-outcome
    interested: number; // apps, best-outcome
    closedWon: number; // apps, best-outcome
    dead: number; // apps, best-outcome
  };
  conversion: {
    replyRate: number | null; // replied / appsContacted
    interestRate: number | null; // (interested+won) / appsContacted
  };
  deal: {
    confirmedValue: number; // closed-won apps * fee
    weightedPipeline: number; // probability-weighted interested + replied
    assumptions: {
      sourcingFee: number;
      interestWinProb: number;
      replyWinProb: number;
    };
  };
  hmo: {
    totalProperties: number;
    primeLeads: number; // aiScore 8+
    lettersDrafted: number;
    lettersSent: number;
  };
  totals: {
    monthlyValueLow: number; // hard ROI only (guaranteed)
    monthlyValueHigh: number; // hard ROI + weighted pipeline
    annualValueLow: number;
    annualValueHigh: number;
  };
}

export async function getRoiSnapshot(): Promise<RoiSnapshot> {
  const [
    leadsSourced,
    leadsScored,
    primeLeads,
    strongLeads,
    appsWithDrafts,
    emailsDrafted,
    emailsSent,
    contactedRows,
    outcomeRows,
    hmoTotal,
    hmoPrime,
    hmoDrafted,
    hmoSent,
  ] = await Promise.all([
    prisma.planningApplication.count(),
    prisma.planningApplication.count({ where: { leadScore: { not: null } } }),
    prisma.planningApplication.count({ where: { leadScore: { gte: PRIME_SCORE } } }),
    prisma.planningApplication.count({ where: { leadScore: { gte: STRONG_SCORE } } }),
    prisma.planningApplication.count({ where: { outreachEmails: { some: {} } } }),
    prisma.outreachEmail.count(),
    prisma.outreachEmail.count({ where: { status: "sent" } }),
    prisma.outreachEmail.findMany({
      where: { status: "sent" },
      select: { applicationId: true },
      distinct: ["applicationId"],
    }),
    prisma.outreachEmail.findMany({
      where: { outcome: { not: null } },
      select: { applicationId: true, outcome: true },
    }),
    prisma.hmoProperty.count(),
    prisma.hmoProperty.count({ where: { aiScore: { gte: PRIME_SCORE } } }),
    prisma.hmoProperty.count({ where: { approachStatus: { not: null } } }),
    prisma.hmoProperty.count({ where: { approachStatus: "sent" } }),
  ]);

  // Collapse per-email outcomes to one best-outcome per application.
  const bestByApp = new Map<string, OutcomeTier>();
  for (const row of outcomeRows) {
    const tier = row.outcome as OutcomeTier;
    if (!TIER_RANK[tier]) continue;
    const current = bestByApp.get(row.applicationId);
    if (!current || TIER_RANK[tier] > TIER_RANK[current]) {
      bestByApp.set(row.applicationId, tier);
    }
  }

  let replied = 0;
  let interested = 0;
  let closedWon = 0;
  let dead = 0;
  for (const tier of bestByApp.values()) {
    if (tier === "closed-won") closedWon++;
    else if (tier === "interested") interested++;
    else if (tier === "replied") replied++;
    else if (tier === "dead") dead++;
  }

  const appsContacted = contactedRows.length;

  const labourValue = HOURS_SAVED_PER_MONTH * HOURLY_RATE;
  const netMonthly = labourValue + TOOLS_REPLACED_MONTHLY - RUNNING_COST_MONTHLY;

  const confirmedValue = closedWon * SOURCING_FEE;
  const weightedPipeline =
    interested * SOURCING_FEE * INTEREST_WIN_PROB + replied * SOURCING_FEE * REPLY_WIN_PROB;

  const monthlyValueLow = netMonthly;
  const monthlyValueHigh = netMonthly + weightedPipeline;

  return {
    generatedAt: new Date().toISOString(),
    hard: {
      hoursSaved: HOURS_SAVED_PER_MONTH,
      labourValue,
      toolsReplaced: TOOLS_REPLACED_MONTHLY,
      runningCost: RUNNING_COST_MONTHLY,
      netMonthly,
      netAnnual: netMonthly * 12,
    },
    funnel: {
      leadsSourced,
      leadsScored,
      primeLeads,
      strongLeads,
      appsWithDrafts,
      emailsDrafted,
      emailsSent,
      appsContacted,
      replied,
      interested,
      closedWon,
      dead,
    },
    conversion: {
      replyRate: appsContacted > 0 ? (replied + interested + closedWon) / appsContacted : null,
      interestRate: appsContacted > 0 ? (interested + closedWon) / appsContacted : null,
    },
    deal: {
      confirmedValue,
      weightedPipeline,
      assumptions: {
        sourcingFee: SOURCING_FEE,
        interestWinProb: INTEREST_WIN_PROB,
        replyWinProb: REPLY_WIN_PROB,
      },
    },
    hmo: {
      totalProperties: hmoTotal,
      primeLeads: hmoPrime,
      lettersDrafted: hmoDrafted,
      lettersSent: hmoSent,
    },
    totals: {
      monthlyValueLow,
      monthlyValueHigh,
      annualValueLow: monthlyValueLow * 12,
      annualValueHigh: monthlyValueHigh * 12,
    },
  };
}
