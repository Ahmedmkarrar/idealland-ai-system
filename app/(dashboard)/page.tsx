"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2,
  FileText,
  Megaphone,
  BarChart3,
  Mail,
  RefreshCw,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Clock,
  Settings,
} from "lucide-react";

interface ConfigStatus {
  resend: boolean;
  anthropic: boolean;
  openai: boolean;
  ayrshare: boolean;
  meta: boolean;
  hmlr: boolean;
  cronSecret: boolean;
  mixmax: boolean;
}

interface Stats {
  sourcing: { totalApplications: number; approvedApplications: number; pendingApplications: number };
  documents: { totalDocuments: number; retrievedDocuments: number; pendingDocuments: number };
  social: { totalPosts: number; publishedPosts: number; scheduledPosts: number };
  ads: { activeCampaigns: number; totalSpend: number; totalLeads: number };
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

const RUN_TYPE_LABELS: Record<string, string> = {
  sourcing: "Sourcing Scan",
  decisions: "Decision Check",
  documents: "Document Retrieval",
  social: "Social Content",
  ads: "Ad Campaigns",
  mailing: "Mailing",
};

const STATUS_ICON = {
  completed: <CheckCircle className="w-3.5 h-3.5 text-green-500" />,
  failed: <AlertCircle className="w-3.5 h-3.5 text-red-500" />,
  running: <Clock className="w-3.5 h-3.5 text-yellow-500 animate-spin" />,
};

const CONFIG_LABELS: Array<{ key: keyof ConfigStatus; label: string; description: string }> = [
  { key: "anthropic", label: "Claude AI", description: "Social content generation" },
  { key: "openai", label: "OpenAI", description: "DALL-E image generation" },
  { key: "ayrshare", label: "Ayrshare", description: "Social media publishing" },
  { key: "resend", label: "Resend", description: "Email alerts & mailing" },
  { key: "meta", label: "Meta Ads", description: "Instagram & Facebook campaigns" },
  { key: "hmlr", label: "HMLR", description: "Land Registry documents" },
  { key: "cronSecret", label: "Cron Secret", description: "Automated daily scheduling" },
  { key: "mixmax", label: "Mixmax", description: "Campaign sending (primary)" },
];

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasData, setHasData] = useState(true);

  const fetchStats = useCallback(async () => {
    const [statsRes, configRes] = await Promise.all([
      fetch("/api/stats"),
      fetch("/api/config-status"),
    ]);
    const data = await statsRes.json();
    const config = await configRes.json();
    setStats(data);
    setConfigStatus(config);
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

  if (!stats) {
    return (
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-5 gap-4">
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
    {
      title: "Documents Retrieved",
      icon: FileText,
      value: stats.documents.retrievedDocuments,
      sub: `${stats.documents.pendingDocuments} pending`,
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
      title: "Ad Spend",
      icon: BarChart3,
      value: `£${stats.ads.totalSpend.toFixed(0)}`,
      sub: `${stats.ads.totalLeads} leads generated`,
      color: "text-green-600",
      bg: "bg-green-50",
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
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Automation Overview</h1>
          <p className="text-muted-foreground text-sm mt-1">
            All 5 automations running for IdealLand
          </p>
        </div>
        <div className="flex gap-2">
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
        </div>
      </div>

      {configStatus && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="w-4 h-4" />
              API Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-8 gap-3">
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

      <div className="grid grid-cols-5 gap-4">
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

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Automation Runs</CardTitle>
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
                      {run.summary && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{run.summary}</p>
                      )}
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
              { label: "Retrieve pending documents", endpoint: "/api/documents", icon: FileText },
              { label: "Generate social content", endpoint: "/api/social", icon: Megaphone },
              { label: "Refresh ad metrics", endpoint: "/api/ads", body: { action: "refresh" }, icon: BarChart3 },
            ].map(({ label, endpoint, body, icon: Icon }) => (
              <Button
                key={label}
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={async () => {
                  await fetch(endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body ?? {}),
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
