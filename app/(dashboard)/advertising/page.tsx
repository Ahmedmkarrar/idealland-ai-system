"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, Plus, Play, Pause, TrendingUp, MousePointer, Eye, Users } from "lucide-react";

interface AdCampaign {
  id: string;
  name: string;
  platform: string;
  status: string;
  budget: number;
  spent: number;
  impressions: number;
  clicks: number;
  leads: number;
  targeting: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  active: "bg-green-100 text-green-800",
  paused: "bg-yellow-100 text-yellow-800",
  completed: "bg-blue-100 text-blue-800",
};

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-pink-100 text-pink-800",
  facebook: "bg-indigo-100 text-indigo-800",
};

export default function AdvertisingPage() {
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const fetchCampaigns = useCallback(async () => {
    const response = await fetch("/api/ads");
    const data = await response.json();
    setCampaigns(data.campaigns);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const handleRefreshMetrics = async () => {
    setIsRefreshing(true);
    await fetch("/api/ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refresh" }),
    });
    await fetchCampaigns();
    setIsRefreshing(false);
  };

  const handleToggle = async (campaign: AdCampaign) => {
    const action = campaign.status === "active" ? "pause" : "activate";
    await fetch("/api/ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, campaignId: campaign.id }),
    });
    await fetchCampaigns();
  };

  const handleCreate = async () => {
    setIsCreating(true);
    const platforms = ["instagram", "facebook"] as const;
    const platform = platforms[Math.floor(Math.random() * platforms.length)];
    await fetch("/api/ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `IdealLand — ${platform === "instagram" ? "Instagram" : "Facebook"} Campaign ${new Date().toLocaleDateString("en-GB")}`,
        platform,
        budget: 500,
        targetAudience: ["architects", "property developers", "investors"],
      }),
    });
    await fetchCampaigns();
    setIsCreating(false);
  };

  const totalSpend = campaigns.reduce((sum, c) => sum + c.spent, 0);
  const totalImpressions = campaigns.reduce((sum, c) => sum + c.impressions, 0);
  const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
  const totalLeads = campaigns.reduce((sum, c) => sum + c.leads, 0);
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Meta Advertising</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Instagram and Facebook campaigns targeting London architects and developers
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleRefreshMetrics} disabled={isRefreshing} variant="outline">
            {isRefreshing ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Refreshing...</>
            ) : (
              <><RefreshCw className="w-4 h-4 mr-2" />Refresh Metrics</>
            )}
          </Button>
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Creating...</>
            ) : (
              <><Plus className="w-4 h-4 mr-2" />New Campaign</>
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Spend", value: `£${totalSpend.toFixed(0)}`, icon: TrendingUp, color: "text-green-600" },
          { label: "Impressions", value: totalImpressions.toLocaleString(), icon: Eye, color: "text-blue-600" },
          { label: "Clicks", value: totalClicks.toLocaleString(), icon: MousePointer, color: "text-purple-600" },
          { label: "Leads", value: totalLeads.toLocaleString(), icon: Users, color: "text-orange-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="text-2xl font-bold">{value}</p>
                </div>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {avgCtr > 0 && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="py-3 flex items-center gap-3">
            <TrendingUp className="w-4 h-4 text-blue-600" />
            <p className="text-sm text-blue-800">
              Average CTR: <strong>{avgCtr.toFixed(2)}%</strong> across all campaigns
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 bg-muted rounded-xl animate-pulse" />
          ))
        ) : campaigns.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No campaigns yet. Click &ldquo;New Campaign&rdquo; to start.</p>
            </CardContent>
          </Card>
        ) : (
          campaigns.map((campaign) => {
            const spendPct = campaign.budget > 0 ? (campaign.spent / campaign.budget) * 100 : 0;
            const ctr = campaign.impressions > 0 ? (campaign.clicks / campaign.impressions) * 100 : 0;
            const targeting = (() => {
              try { return JSON.parse(campaign.targeting); } catch { return {}; }
            })();

            return (
              <Card key={campaign.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PLATFORM_COLORS[campaign.platform] ?? "bg-gray-100"}`}>
                        {campaign.platform.charAt(0).toUpperCase() + campaign.platform.slice(1)}
                      </span>
                      <CardTitle className="text-base">{campaign.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[campaign.status] ?? "bg-gray-100"}`}>
                        {campaign.status}
                      </span>
                      {campaign.status !== "completed" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggle(campaign)}
                        >
                          {campaign.status === "active" ? (
                            <Pause className="w-4 h-4" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-4 mb-4">
                    {[
                      { label: "Impressions", value: campaign.impressions.toLocaleString() },
                      { label: "Clicks", value: campaign.clicks.toLocaleString() },
                      { label: "CTR", value: `${ctr.toFixed(2)}%` },
                      { label: "Leads", value: campaign.leads.toString() },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="text-lg font-semibold">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Budget: £{campaign.spent.toFixed(0)} / £{campaign.budget.toFixed(0)}</span>
                      <span>{spendPct.toFixed(0)}%</span>
                    </div>
                    <Progress value={spendPct} className="h-1.5" />
                  </div>
                  {targeting.audiences && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Targeting: {(targeting.audiences as string[]).join(", ")} · {targeting.locations?.join(", ")}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
