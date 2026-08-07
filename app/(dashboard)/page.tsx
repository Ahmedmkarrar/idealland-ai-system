"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2,
  Megaphone,
  Mail,
  RefreshCw,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Clock,
  Settings,
  Activity,
  Database,
  Zap,
  Send,
} from "lucide-react";

interface ConfigStatus {
  resend: boolean;
  anthropic: boolean;
  openai: boolean;
  hmlr: boolean;
  cronSecret: boolean;
  mixmax: boolean;
  xero: boolean;
}

interface Stats {
  sourcing: { totalApplications: number; approvedApplications: number; pendingApplications: number; primeLeads: number };
  outreach: { readyToSend: number; approachesSent: number };
  documents: { totalDocuments: number; retrievedDocuments: number; pendingDocuments: number };
  social: { totalPosts: number; publishedPosts: number; scheduledPosts: number };
  mailing: { totalContacts: number; sentMailCampaigns: number };
  recentRuns: Array<{
    id: string;
    type: string;
    status: string;
    summary: string | null;
    startedAt: string;
    completedAt: string | null;
  }>;
}

interface Health {
  ok: boolean;
  uptimeSeconds: number;
  dbReachable: boolean;
  dbLatencyMs: number | null;
  lastCronAt: string | null;
  lastCronStatus: string | null;
  checkedAt: string;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Cron fires at 0 */4 * * * — figure out the next 4-hour boundary in UTC
function nextCronRelative(): string {
  const now = new Date();
  const next = new Date(now);
  const hour = now.getUTCHours();
  const nextHour = Math.ceil((hour + 1) / 4) * 4;
  next.setUTCHours(nextHour, 0, 0, 0);
  if (next <= now) next.setUTCHours(next.getUTCHours() + 4);
  const diffMin = Math.round((next.getTime() - now.getTime()) / 60_000);
  if (diffMin < 60) return `in ${diffMin} min`;
  return `in ${Math.floor(diffMin / 60)}h ${diffMin % 60}m`;
}

// Named for what they do for the business, not for the service that runs them —
// "Document Retrieval" meant nothing to the people reading this feed.
const RUN_TYPE_LABELS: Record<string, string> = {
  sourcing: "Looked for new sites",
  decisions: "Checked for planning decisions",
  documents: "Fetched Land Registry documents",
  social: "Drafted social content",
  mailing: "Sent mailing campaign",
  outreach: "Drafted approach emails",
  "decisions-backfill": "Backfilled past decisions",
  "hmo-ingest": "Updated the HMO register",
  invoicing: "Generated invoices",
  ads: "Updated ad campaigns",
};

// What each run type is actually for, shown under the feed so nobody has to ask.
const RUN_TYPE_EXPLAINER: Record<string, string> = {
  sourcing: "Pulls new 1-9 unit planning applications from the London-wide feed every 4 hours.",
  decisions: "Re-checks sites already in the list to see if the council has decided them.",
  documents: "Looks up Land Registry title documents for a site. Needs an HMLR key — off until one is added.",
};

const STATUS_ICON = {
  completed: <CheckCircle className="w-3.5 h-3.5 text-green-500" />,
  failed: <AlertCircle className="w-3.5 h-3.5 text-red-500" />,
  running: <Clock className="w-3.5 h-3.5 text-yellow-500 animate-spin" />,
};

const CONFIG_LABELS: Array<{ key: keyof ConfigStatus; label: string; description: string }> = [
  { key: "anthropic", label: "Claude AI", description: "Social content drafting" },
  { key: "openai", label: "OpenAI", description: "DALL-E image generation" },
  { key: "resend", label: "Resend", description: "Planning alerts + outreach mail" },
  { key: "hmlr", label: "HMLR", description: "Land Registry documents" },
  { key: "cronSecret", label: "Cron Secret", description: "Automated daily scheduling" },
  { key: "mixmax", label: "Mixmax (opt)", description: "Optional — Resend covers mailing" },
  { key: "xero", label: "Xero (opt)", description: "Optional — invoices mark sent locally without" },
];

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [hasData, setHasData] = useState(true);

  const fetchStats = useCallback(async () => {
    const [statsRes, configRes, healthRes] = await Promise.all([
      fetch("/api/stats"),
      fetch("/api/config-status"),
      fetch("/api/health"),
    ]);
    const data = await statsRes.json();
    const config = await configRes.json();
    const healthData = await healthRes.json();
    setStats(data);
    setConfigStatus(config);
    setHealth(healthData);
    setHasData(data.sourcing.totalApplications > 0);
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleSeed = async () => {
    setIsSeeding(true);
    await fetch("/api/seed", { method: "POST" });
    await fetchStats();
    setIsSeeding(false);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchStats();
    setIsRefreshing(false);
  };

  const handleRunScanNow = async () => {
    setIsScanning(true);
    const response = await fetch("/api/cron/trigger", { method: "POST" });
    const result = await response.json();
    if (result.sourcing) {
      const s = result.sourcing as { found?: number; boroughsWithMatches?: number; error?: string };
      if (s.error) {
        alert(`Sourcing failed: ${s.error}`);
      } else {
        const found = s.found ?? 0;
        alert(
          `Scan complete.\n` +
          `Sourcing: ${found} new ${found === 1 ? "opportunity" : "opportunities"} across ${s.boroughsWithMatches ?? 0} borough(s).\n` +
          `See "What the system has been doing" below for full details.`
        );
      }
    }
    await fetchStats();
    setIsScanning(false);
  };

  if (!stats) {
    return (
      <div className="p-4 sm:p-8 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const statCards = [
    {
      title: "Planning Applications",
      icon: Building2,
      value: stats.sourcing.totalApplications,
      sub: `${stats.sourcing.pendingApplications} pending`,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    // Was "Documents Retrieved", which counted placeholder rows the system can't
    // fetch without an HMLR key. This tile answers the question actually being
    // asked at a glance: how many approaches are waiting to go out?
    {
      title: "Ready to Send",
      icon: Send,
      value: stats.outreach.readyToSend,
      sub: `${stats.outreach.approachesSent} sent so far`,
      color: "text-purple-600",
      bg: "bg-purple-50",
    },
    {
      title: "Social Posts",
      icon: Megaphone,
      value: stats.social.totalPosts,
      sub: `${stats.social.scheduledPosts} scheduled`,
      color: "text-orange-600",
      bg: "bg-orange-50",
    },
    {
      title: "Mailing List",
      icon: Mail,
      value: stats.mailing.totalContacts,
      sub: `${stats.mailing.sentMailCampaigns} campaigns sent`,
      color: "text-rose-600",
      bg: "bg-rose-50",
    },
  ];

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Automation Overview</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Finding 1–9 unit residential sites across all 33 London boroughs, every 4 hours
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSeed} disabled={isSeeding} variant="outline" size="sm">
            {isSeeding ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Loading contacts...</>
            ) : (
              <><TrendingUp className="w-4 h-4 mr-2" />Load Contacts</>
            )}
          </Button>
          <Button onClick={handleRefresh} disabled={isRefreshing} variant="outline" size="sm">
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button onClick={handleRunScanNow} disabled={isScanning} size="sm">
            {isScanning ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Scanning (2-4 min)...</>
            ) : (
              <><Zap className="w-4 h-4 mr-2" />Run scan now</>
            )}
          </Button>
        </div>
      </div>

      {health && (
        <Card className={health.ok ? "border-green-200 bg-green-50/40" : "border-red-200 bg-red-50/60"}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className={`w-4 h-4 ${health.ok ? "text-green-600" : "text-red-600"}`} />
              System Health
              <Badge className={`text-xs ml-1 ${health.ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`} variant="outline">
                {health.ok ? "live" : "down"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="flex items-start gap-2">
                <Zap className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Uptime</p>
                  <p className="text-sm font-semibold">{formatUptime(health.uptimeSeconds)}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Database className={`w-4 h-4 mt-0.5 shrink-0 ${health.dbReachable ? "text-green-600" : "text-red-600"}`} />
                <div>
                  <p className="text-xs text-muted-foreground">Database</p>
                  <p className="text-sm font-semibold">
                    {health.dbReachable
                      ? `${health.dbLatencyMs ?? "?"} ms`
                      : "unreachable"}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Last cron run</p>
                  <p className="text-sm font-semibold">
                    {health.lastCronAt
                      ? <>{formatRelative(health.lastCronAt)} <span className="text-xs text-muted-foreground font-normal">· {health.lastCronStatus}</span></>
                      : "never"}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <RefreshCw className="w-4 h-4 text-purple-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Next cron run</p>
                  <p className="text-sm font-semibold">{nextCronRelative()}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {configStatus && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="w-4 h-4" />
              API Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
              {CONFIG_LABELS.map(({ key, label, description }) => {
                const isActive = configStatus[key];
                return (
                  <div key={key} className={`rounded-lg border p-3 ${isActive ? "border-green-200 bg-green-50" : "border-orange-200 bg-orange-50"}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      {isActive
                        ? <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                        : <AlertCircle className="w-3.5 h-3.5 text-orange-500" />}
                      <span className={`text-xs font-semibold ${isActive ? "text-green-800" : "text-orange-800"}`}>{label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{description}</p>
                    <p className={`text-xs font-medium mt-1 ${isActive ? "text-green-700" : "text-orange-700"}`}>
                      {isActive ? "Active" : "Key needed"}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {!hasData && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold text-lg">No planning data yet</h3>
            <p className="text-muted-foreground text-sm mt-1 mb-4">
              Click &ldquo;Load Contacts&rdquo; to add the mailing list, then &ldquo;Scan Councils&rdquo; to fetch real planning applications from London boroughs.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(({ title, icon: Icon, value, sub, color, bg }) => (
          <Card key={title}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{title}</p>
                  <p className="text-2xl font-bold mt-1">{value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{sub}</p>
                </div>
                <div className={`p-2 rounded-lg ${bg}`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What the system has been doing</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              A log of the automatic jobs that keep the site list current. Nothing here needs
              action from you — it&apos;s here so you can see the system is running.
            </p>
          </CardHeader>
          <CardContent>
            {stats.recentRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet</p>
            ) : (
              <div className="space-y-3">
                {stats.recentRuns.map((run) => (
                  <div key={run.id} className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {STATUS_ICON[run.status as keyof typeof STATUS_ICON]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">
                          {RUN_TYPE_LABELS[run.type] ?? run.type}
                        </p>
                        <Badge
                          variant={run.status === "completed" ? "default" : run.status === "failed" ? "destructive" : "secondary"}
                          className="text-xs shrink-0"
                        >
                          {run.status}
                        </Badge>
                      </div>
                      {run.summary ? (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{run.summary}</p>
                      ) : RUN_TYPE_EXPLAINER[run.type] ? (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{RUN_TYPE_EXPLAINER[run.type]}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(run.startedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: "Scan councils for new applications", endpoint: "/api/sourcing", icon: Building2 },
              // "Retrieve pending documents" removed: Land Registry retrieval is off
              // without an HMLR key, so the button did nothing and contradicted the
              // Documents page, which tells the client there is nothing to action.
              { label: "Generate social content", endpoint: "/api/social", icon: Megaphone },
              { label: "Send outreach mail", endpoint: "/api/mailing", icon: Mail },
            ].map(({ label, endpoint, icon: Icon }) => (
              <Button
                key={label}
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={async () => {
                  await fetch(endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}",
                  });
                  await fetchStats();
                }}
              >
                <Icon className="w-4 h-4 mr-2" />
                {label}
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
