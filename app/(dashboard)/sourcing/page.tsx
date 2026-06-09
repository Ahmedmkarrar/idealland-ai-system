"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Search, ScanLine, Building2, MapPin, Calendar, ChevronDown, ChevronRight, Clock, CheckCircle, XCircle, AlertCircle, Sparkles, Send, Mail } from "lucide-react";

interface PlanningApplication {
  id: string;
  reference: string;
  council: string;
  address: string;
  description: string;
  units: number;
  status: string;
  applicant: string | null;
  submittedAt: string;
  alertSent: boolean;
  intelligenceSummary: string | null;
  leadScore: number | null;
  leadScoreReason: string | null;
  analyzedAt: string | null;
  documents: Array<{ id: string; type: string; status: string }>;
}

function scoreBadgeClass(score: number | null): string {
  if (score == null) return "bg-gray-100 text-gray-500 border-gray-200";
  if (score >= 8) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (score >= 5) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

interface StatusChange {
  id: string;
  fromStatus: string;
  toStatus: string;
  changedAt: string;
  alertSent: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  refused: "bg-red-100 text-red-800",
  withdrawn: "bg-gray-100 text-gray-800",
};

const STATUS_TIMELINE_ICON: Record<string, React.ReactNode> = {
  approved: <CheckCircle className="w-4 h-4 text-green-600" />,
  refused: <XCircle className="w-4 h-4 text-red-600" />,
  withdrawn: <AlertCircle className="w-4 h-4 text-gray-500" />,
  submitted: <Clock className="w-4 h-4 text-blue-500" />,
};

export default function SourcingPage() {
  const [applications, setApplications] = useState<PlanningApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isCheckingDecisions, setIsCheckingDecisions] = useState(false);
  const [isBulkAnalyzing, setIsBulkAnalyzing] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [generatingOutreachId, setGeneratingOutreachId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("submitted");
  const [lastScanResult, setLastScanResult] = useState<{ found: number; alerted: number } | null>(null);
  const [expandedAppId, setExpandedAppId] = useState<string | null>(null);
  const [statusHistories, setStatusHistories] = useState<Record<string, StatusChange[]>>({});

  const fetchApplications = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    const response = await fetch(`/api/sourcing?${params}`);
    const applicationsData = await response.json();
    setApplications(applicationsData.applications);
    setIsLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const handleScan = async () => {
    setIsScanning(true);
    const response = await fetch("/api/sourcing", { method: "POST" });
    const scanResult = await response.json();
    setLastScanResult(scanResult);
    await fetchApplications();
    setIsScanning(false);
  };

  const handleCheckDecisions = async () => {
    setIsCheckingDecisions(true);
    await fetch("/api/decisions", { method: "POST" });
    await fetchApplications();
    setIsCheckingDecisions(false);
  };

  const handleBulkAnalyze = async () => {
    setIsBulkAnalyzing(true);
    const response = await fetch("/api/sourcing/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bulk: true, limit: 20 }),
    });
    const result = await response.json();
    alert(
      result.reason
        ? result.reason
        : `Analyzed ${result.analyzed} application(s). ${result.skipped > 0 ? `${result.skipped} skipped.` : ""}`
    );
    await fetchApplications();
    setIsBulkAnalyzing(false);
  };

  const handleAnalyzeOne = async (appId: string, force = false) => {
    setAnalyzingId(appId);
    await fetch("/api/sourcing/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: appId, force }),
    });
    await fetchApplications();
    setAnalyzingId(null);
  };

  const handleGenerateOutreach = async (appId: string) => {
    setGeneratingOutreachId(appId);
    const response = await fetch("/api/outreach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: appId }),
    });
    const result = await response.json();
    alert(
      result.reason
        ? result.reason
        : `Drafted ${result.drafted} outreach email(s). Review on the Mailing page.`
    );
    setGeneratingOutreachId(null);
  };

  const handleToggleHistory = async (applicationId: string) => {
    if (expandedAppId === applicationId) {
      setExpandedAppId(null);
      return;
    }
    setExpandedAppId(applicationId);
    if (!statusHistories[applicationId]) {
      const response = await fetch(`/api/decisions?applicationId=${applicationId}`);
      const historyData = await response.json();
      setStatusHistories((prev) => ({ ...prev, [applicationId]: historyData.history ?? [] }));
    }
  };

  const filtered = applications
    .filter((app) =>
      searchQuery
        ? app.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
          app.council.toLowerCase().includes(searchQuery.toLowerCase()) ||
          app.reference.toLowerCase().includes(searchQuery.toLowerCase())
        : true
    )
    .sort((a, b) => {
      if (sortBy === "score") {
        return (b.leadScore ?? -1) - (a.leadScore ?? -1);
      }
      if (sortBy === "units") {
        return b.units - a.units;
      }
      return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
    });

  const unanalyzedCount = applications.filter((a) => !a.intelligenceSummary || !a.leadScore).length;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Planning Sourcing</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Monitoring all 27 London boroughs for 10+ unit residential developments
          </p>
        </div>
        <div className="flex gap-2">
          {unanalyzedCount > 0 && (
            <Button onClick={handleBulkAnalyze} disabled={isBulkAnalyzing} variant="outline">
              {isBulkAnalyzing ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Analyzing...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" />Analyze {unanalyzedCount} pending</>
              )}
            </Button>
          )}
          <Button onClick={handleCheckDecisions} disabled={isCheckingDecisions} variant="outline">
            {isCheckingDecisions ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Checking...</>
            ) : (
              <><AlertCircle className="w-4 h-4 mr-2" />Check Decisions</>
            )}
          </Button>
          <Button onClick={handleScan} disabled={isScanning}>
            {isScanning ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Scanning...</>
            ) : (
              <><ScanLine className="w-4 h-4 mr-2" />Scan Now</>
            )}
          </Button>
        </div>
      </div>

      {lastScanResult && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="py-3 flex items-center gap-3">
            <Building2 className="w-4 h-4 text-green-600" />
            <p className="text-sm text-green-800">
              Scan complete — found <strong>{lastScanResult.found}</strong> new applications,
              sent <strong>{lastScanResult.alerted}</strong> alerts
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total", value: applications.length, color: "text-foreground" },
          { label: "Submitted", value: applications.filter((a) => a.status === "submitted").length, color: "text-blue-600" },
          { label: "Approved", value: applications.filter((a) => a.status === "approved").length, color: "text-green-600" },
          { label: "Avg Units", value: applications.length ? Math.round(applications.reduce((sum, a) => sum + a.units, 0) / applications.length) : 0, color: "text-purple-600" },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by address, council, reference..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="refused">Refused</SelectItem>
                <SelectItem value="withdrawn">Withdrawn</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v ?? "submitted")}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="submitted">Newest first</SelectItem>
                <SelectItem value="score">Highest score</SelectItem>
                <SelectItem value="units">Most units</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No applications found. Click &ldquo;Scan Now&rdquo; to discover new ones.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="w-14 text-center">Score</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Council</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Docs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((app) => (
                  <>
                    <TableRow
                      key={app.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleToggleHistory(app.id)}
                    >
                      <TableCell className="py-3">
                        {expandedAppId === app.id
                          ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                      </TableCell>
                      <TableCell className="text-center py-3">
                        <span
                          className={`inline-flex items-center justify-center min-w-[28px] h-6 rounded-full text-xs font-bold border ${scoreBadgeClass(app.leadScore)}`}
                          title={app.leadScoreReason ?? "Not analyzed yet"}
                        >
                          {app.leadScore ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{app.reference}</TableCell>
                      <TableCell>
                        <div className="flex items-start gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                          <span className="text-sm">{app.address}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{app.council}</TableCell>
                      <TableCell className="text-right font-semibold">{app.units}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[app.status] ?? "bg-gray-100 text-gray-800"}`}>
                          {app.status}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          {new Date(app.submittedAt).toLocaleDateString("en-GB")}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {app.documents.length}
                        </Badge>
                      </TableCell>
                    </TableRow>

                    {expandedAppId === app.id && (
                      <TableRow key={`${app.id}-history`}>
                        <TableCell colSpan={9} className="bg-muted/30 px-6 py-4">
                          <div className="space-y-5">
                            {/* AI Intelligence Summary */}
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                                  <Sparkles className="w-3 h-3" />AI Intelligence
                                </p>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2.5 text-xs"
                                    onClick={() => handleAnalyzeOne(app.id, !!app.intelligenceSummary)}
                                    disabled={analyzingId === app.id}
                                  >
                                    {analyzingId === app.id
                                      ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Analyzing</>
                                      : <><Sparkles className="w-3 h-3 mr-1" />{app.intelligenceSummary ? "Re-analyze" : "Analyze"}</>}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2.5 text-xs"
                                    onClick={() => handleGenerateOutreach(app.id)}
                                    disabled={generatingOutreachId === app.id}
                                  >
                                    {generatingOutreachId === app.id
                                      ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Drafting</>
                                      : <><Mail className="w-3 h-3 mr-1" />Draft Outreach</>}
                                  </Button>
                                </div>
                              </div>
                              {app.intelligenceSummary ? (
                                <div className="bg-white border rounded-lg p-3 space-y-2">
                                  <p className="text-sm leading-relaxed">{app.intelligenceSummary}</p>
                                  {app.leadScoreReason && (
                                    <p className="text-xs text-muted-foreground">
                                      <span className="font-semibold">Score {app.leadScore}/10:</span> {app.leadScoreReason}
                                    </p>
                                  )}
                                  {app.analyzedAt && (
                                    <p className="text-xs text-muted-foreground">
                                      Analyzed {new Date(app.analyzedAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <p className="text-sm text-muted-foreground italic">
                                  Not analyzed yet — click <strong>Analyze</strong> to generate intelligence brief + lead score.
                                </p>
                              )}
                            </div>

                            {/* Description (for context) */}
                            {app.description && (
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Application description</p>
                                <p className="text-sm leading-relaxed text-muted-foreground">{app.description}</p>
                              </div>
                            )}

                            {/* Status history */}
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Status History</p>
                              {!statusHistories[app.id] ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  Loading history...
                                </div>
                              ) : statusHistories[app.id].length === 0 ? (
                                <p className="text-sm text-muted-foreground">No status changes recorded yet.</p>
                              ) : (
                                <div className="relative">
                                  <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
                                  <div className="space-y-3">
                                    {statusHistories[app.id].map((change) => (
                                      <div key={change.id} className="flex items-start gap-3 relative">
                                        <div className="z-10 bg-background">
                                          {STATUS_TIMELINE_ICON[change.toStatus] ?? <Clock className="w-4 h-4 text-muted-foreground" />}
                                        </div>
                                        <div>
                                          <p className="text-sm font-medium capitalize">
                                            {change.fromStatus} → {change.toStatus}
                                          </p>
                                          <p className="text-xs text-muted-foreground">
                                            {new Date(change.changedAt).toLocaleString("en-GB")}
                                          </p>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
