// ROI snapshot — turns the system's activity into a single, defensible "money
// view" the client can look at and immediately see the return.
//
// Two kinds of ROI:
//   1. Hard ROI  — labour + software the system replaces. Real every month,
//      independent of whether any deal closes. Cost-substitution.
//   2. Deal ROI  — sourcing fees from sites the AGENT-approach pipeline turns
//      into "owner open to selling" conversations and completed deals. This
//      tracks IdealLand's actual workflow: site → find the agent → ask about
//      selling → introduce to a developer → earn the fee.
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
const HOURS_SAVED_PER_MONTH = num("ROI_HOURS_SAVED", 115);
const HOURLY_RATE = num("ROI_HOURLY_RATE", 25);
const TOOLS_REPLACED_MONTHLY = num("ROI_TOOLS_REPLACED", 600);
const RUNNING_COST_MONTHLY = num("ROI_RUNNING_COST", 50);

// --- Deal ROI assumptions ---
const SOURCING_FEE = num("ROI_SOURCING_FEE", 5000); // avg fee per completed sourced deal (£)
const INTEREST_WIN_PROB = num("ROI_INTEREST_WIN_PROB", 0.3); // P(owner-interested → deal)
const REPLY_WIN_PROB = num("ROI_REPLY_WIN_PROB", 0.1); // P(agent-replied → deal)

const PRIME_SCORE = 8;
const STRONG_SCORE = 6;

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
    contactsFound: number; // agent contact located
    approachesDrafted: number; // seller-approach written
    approachesSent: number; // approach sent to the agent
    replied: number;
    interested: number; // owner open to selling
    closedWon: number; // deal completed
    dead: number;
  };
  conversion: {
    replyRate: number | null; // any response / approaches sent
    interestRate: number | null; // (interested+won) / approaches sent
  };
  deal: {
    confirmedValue: number; // won * fee
    weightedPipeline: number; // probability-weighted interested + replied
    assumptions: { sourcingFee: number; interestWinProb: number; replyWinProb: number };
  };
  hmo: {
    totalProperties: number;
    primeLeads: number; // aiScore 8+
    lettersDrafted: number;
    lettersSent: number;
  };
  totals: {
    monthlyValueLow: number;
    monthlyValueHigh: number;
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
    contactsFound,
    approachesDrafted,
    approachesSent,
    replied,
    interested,
    closedWon,
    dead,
    hmoTotal,
    hmoPrime,
    hmoDrafted,
    hmoSent,
  ] = await Promise.all([
    prisma.planningApplication.count(),
    prisma.planningApplication.count({ where: { leadScore: { not: null } } }),
    prisma.planningApplication.count({ where: { leadScore: { gte: PRIME_SCORE } } }),
    prisma.planningApplication.count({ where: { leadScore: { gte: STRONG_SCORE } } }),
    prisma.planningApplication.count({ where: { contactStatus: "found" } }),
    prisma.planningApplication.count({ where: { approachStatus: { not: null } } }),
    prisma.planningApplication.count({ where: { approachStatus: "sent" } }),
    prisma.planningApplication.count({ where: { approachOutcome: "replied" } }),
    prisma.planningApplication.count({ where: { approachOutcome: "interested" } }),
    prisma.planningApplication.count({ where: { approachOutcome: "won" } }),
    prisma.planningApplication.count({ where: { approachOutcome: "dead" } }),
    prisma.hmoProperty.count(),
    prisma.hmoProperty.count({ where: { aiScore: { gte: PRIME_SCORE } } }),
    prisma.hmoProperty.count({ where: { approachStatus: { not: null } } }),
    prisma.hmoProperty.count({ where: { approachStatus: "sent" } }),
  ]);

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
      contactsFound,
      approachesDrafted,
      approachesSent,
      replied,
      interested,
      closedWon,
      dead,
    },
    conversion: {
      replyRate: approachesSent > 0 ? (replied + interested + closedWon) / approachesSent : null,
      interestRate: approachesSent > 0 ? (interested + closedWon) / approachesSent : null,
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
