"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw,
  PoundSterling,
  Clock,
  Boxes,
  Send,
  Reply,
  Handshake,
  Trophy,
  Building2,
  TrendingUp,
} from "lucide-react";

interface RoiSnapshot {
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
    primeLeads: number;
    strongLeads: number;
    appsWithDrafts: number;
    emailsDrafted: number;
    emailsSent: number;
    appsContacted: number;
    replied: number;
    interested: number;
    closedWon: number;
    dead: number;
  };
  conversion: { replyRate: number | null; interestRate: number | null };
  deal: {
    confirmedValue: number;
    weightedPipeline: number;
    assumptions: { sourcingFee: number; interestWinProb: number; replyWinProb: number };
  };
  hmo: { totalProperties: number; primeLeads: number; lettersDrafted: number; lettersSent: number };
  totals: {
    monthlyValueLow: number;
    monthlyValueHigh: number;
    annualValueLow: number;
    annualValueHigh: number;
  };
}

function money(n: number, opts?: { compact?: boolean }): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
    notation: opts?.compact ? "compact" : "standard",
  }).format(n);
}

function pct(n: number | null): string {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

export default function RoiPage() {
  const [roi, setRoi] = useState<RoiSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/roi");
      setRoi(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !roi) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 rounded-2xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  const funnelSteps = [
    { label: "Sourced", value: roi.funnel.leadsSourced, icon: Boxes, tone: "text-slate-700" },
    { label: "AI-scored", value: roi.funnel.leadsScored, icon: TrendingUp, tone: "text-slate-700" },
    { label: "Prime (8+)", value: roi.funnel.primeLeads, icon: Trophy, tone: "text-amber-600" },
    { label: "Contacted", value: roi.funnel.appsContacted, icon: Send, tone: "text-blue-600" },
    { label: "Replied", value: roi.funnel.replied, icon: Reply, tone: "text-indigo-600" },
    { label: "Interested", value: roi.funnel.interested, icon: Handshake, tone: "text-violet-600" },
    { label: "Closed-won", value: roi.funnel.closedWon, icon: Trophy, tone: "text-emerald-600" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Return on Investment</h1>
          <p className="text-muted-foreground text-sm mt-1">
            What the automation is worth to IdealLand — hard cost savings plus live deal pipeline.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="shrink-0">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Headline value */}
      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-50/30">
        <CardContent className="py-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">
                Estimated value delivered
              </p>
              <div className="mt-2 flex items-end gap-3 flex-wrap">
                <span className="text-4xl md:text-5xl font-bold text-emerald-900">
                  {money(roi.totals.monthlyValueLow, { compact: true })}
                  <span className="text-2xl text-emerald-700"> – {money(roi.totals.monthlyValueHigh, { compact: true })}</span>
                </span>
                <span className="text-sm text-emerald-700 mb-1">/ month</span>
              </div>
              <p className="text-sm text-emerald-800/80 mt-2">
                {money(roi.totals.annualValueLow, { compact: true })} – {money(roi.totals.annualValueHigh, { compact: true })} per year.
                Low = guaranteed cost savings. High = savings + probability-weighted deal pipeline.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="Guaranteed / mo" value={money(roi.hard.netMonthly)} sub="cost substitution" />
              <MiniStat label="Deal pipeline" value={money(roi.deal.weightedPipeline)} sub="weighted, live" accent />
              <MiniStat label="Confirmed deals" value={money(roi.deal.confirmedValue)} sub={`${roi.funnel.closedWon} closed-won`} />
              <MiniStat label="Leads working" value={roi.funnel.strongLeads.toLocaleString()} sub="score 6+ ready" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Hard ROI */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald-600" />
              Hard ROI — cost substitution (every month)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Line label={`Labour replaced (${roi.hard.hoursSaved} hrs @ ${money(roi.hard.labourValue / roi.hard.hoursSaved)}/hr)`} value={money(roi.hard.labourValue)} />
            <Line label="Software / tools replaced" value={money(roi.hard.toolsReplaced)} />
            <Line label="Less: running cost" value={`– ${money(roi.hard.runningCost)}`} muted />
            <div className="border-t pt-3 flex items-center justify-between">
              <span className="text-sm font-semibold">Net monthly saving</span>
              <span className="text-lg font-bold text-emerald-700">{money(roi.hard.netMonthly)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Annualised</span>
              <span className="text-sm font-semibold text-emerald-700">{money(roi.hard.netAnnual)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Deal value */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <PoundSterling className="h-4 w-4 text-violet-600" />
              Deal ROI — sourcing fee pipeline
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Line label={`Confirmed (${roi.funnel.closedWon} closed-won × ${money(roi.deal.assumptions.sourcingFee)})`} value={money(roi.deal.confirmedValue)} />
            <Line label={`Interested (${roi.funnel.interested} × ${money(roi.deal.assumptions.sourcingFee)} × ${pct(roi.deal.assumptions.interestWinProb)})`} value={money(roi.funnel.interested * roi.deal.assumptions.sourcingFee * roi.deal.assumptions.interestWinProb)} />
            <Line label={`Replied (${roi.funnel.replied} × ${money(roi.deal.assumptions.sourcingFee)} × ${pct(roi.deal.assumptions.replyWinProb)})`} value={money(roi.funnel.replied * roi.deal.assumptions.sourcingFee * roi.deal.assumptions.replyWinProb)} />
            <div className="border-t pt-3 flex items-center justify-between">
              <span className="text-sm font-semibold">Weighted pipeline value</span>
              <span className="text-lg font-bold text-violet-700">{money(roi.deal.weightedPipeline)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Reply rate {pct(roi.conversion.replyRate)} · interest rate {pct(roi.conversion.interestRate)} on {roi.funnel.appsContacted} contacted.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline funnel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-blue-600" />
            Lead-to-deal pipeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {funnelSteps.map((step) => {
              const Icon = step.icon;
              return (
                <div key={step.label} className="rounded-lg border p-3 text-center">
                  <Icon className={`h-4 w-4 mx-auto mb-1 ${step.tone}`} />
                  <p className={`text-xl font-bold ${step.tone}`}>{step.value.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{step.label}</p>
                </div>
              );
            })}
          </div>
          {roi.funnel.appsContacted === 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mt-4">
              No outreach sent yet. The pipeline stays at &quot;scored&quot; until emails go out — go to <strong>Mailing → AI Outreach Drafts</strong> and send, or draft in bulk from <strong>Sourcing</strong>.
            </p>
          )}
        </CardContent>
      </Card>

      {/* HMO channel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-teal-600" />
            HMO acquisition channel (off-market)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MiniStat label="HMOs tracked" value={roi.hmo.totalProperties.toLocaleString()} sub="Camden register" />
            <MiniStat label="Prime leads (8+)" value={roi.hmo.primeLeads.toLocaleString()} sub="AI acquisition score" />
            <MiniStat label="Letters drafted" value={roi.hmo.lettersDrafted.toLocaleString()} sub="approach ready" />
            <MiniStat label="Letters sent" value={roi.hmo.lettersSent.toLocaleString()} sub="in market" />
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Money figures use configurable assumptions (sourcing fee {money(roi.deal.assumptions.sourcingFee)}, hourly rate {money(roi.hard.labourValue / roi.hard.hoursSaved)}). Confirmed value counts only closed-won deals. Snapshot {new Date(roi.generatedAt).toLocaleString("en-GB")}.
      </p>
    </div>
  );
}

function MiniStat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? "border-violet-200 bg-violet-50/50" : "bg-white/60"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${accent ? "text-violet-700" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={`text-sm ${muted ? "text-muted-foreground" : ""}`}>{label}</span>
      <span className={`text-sm font-semibold shrink-0 ${muted ? "text-muted-foreground" : ""}`}>{value}</span>
    </div>
  );
}
