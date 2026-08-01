"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Search, ScanLine, Building2, MapPin, Calendar, ChevronDown, ChevronRight, Clock, CheckCircle, XCircle, AlertCircle, Sparkles, Send, Mail, Users } from "lucide-react";

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
  councilUrl: string | null;
  agentName: string | null;
  agentFirm: string | null;
  agentEmail: string | null;
  agentPhone: string | null;
  agentWebsite: string | null;
  contactStatus: string | null;
  contactNotes: string | null;
  approachSubject: string | null;
  approachBody: string | null;
  approachStatus: string | null;
  approachOutcome: string | null;
  documents: Array<{ id: string; type: string; status: string }>;
}

function scoreBadgeClass(score: number | null): string {
  if (score == null) return "bg-gray-100 text-gray-500 border-gray-200";
  if (score >= 8) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (score >= 5) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

// Deterministic last-mile lookups for the human — never scrape LinkedIn.
function linkedinSearchUrl(name: string | null, firm: string | null): string {
  const q = [name, firm].filter(Boolean).join(" ");
  return `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(q || "planning consultant")}`;
}
function googleSearchUrl(name: string | null, firm: string | null, council: string): string {
  const q = [name, firm, name || firm ? "" : `${council} planning agent`, "contact email"].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
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

  const [findingContactId, setFindingContactId] = useState<string | null>(null);
  const [draftingApproachId, setDraftingApproachId] = useState<string | null>(null);

  const handleFindContact = async (appId: string, force = false) => {
    setFindingContactId(appId);
    const response = await fetch("/api/sourcing/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: appId, force }),
    });
    const result = await response.json();
    if (!result.ok) alert(result.reason ?? result.error ?? "Could not find contact");
    await fetchApplications();
    setFindingContactId(null);
  };

  const handleDraftApproach = async (appId: string, force = false) => {
    setDraftingApproachId(appId);
    const response = await fetch("/api/sourcing/approach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: appId, force }),
    });
    const result = await response.json();
    if (!result.ok) alert(result.reason ?? result.error ?? "Could not draft approach");
    await fetchApplications();
    setDraftingApproachId(null);
  };

  const handleApproachState = async (
    appId: string,
    changes: { status?: string; outcome?: string | null }
  ) => {
    await fetch("/api/sourcing/approach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: appId, ...changes }),
    });
    await fetchApplications();
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
  const readyToSendCount = applications.filter(
    (a) => a.contactStatus === "found" && a.approachBody && a.approachStatus !== "sent"
  ).length;

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Planning Sourcing</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Monitoring all 33 London boroughs for 1&ndash;9 unit residential schemes
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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

      {/* The researched leads are easy to lose among ~2,000 rows — send staff
          straight to the queue that has a contact and a written email. */}
      {readyToSendCount > 0 && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="py-3 flex flex-wrap items-center gap-3">
            <Mail className="w-4 h-4 text-emerald-600 shrink-0" />
            <p className="text-sm text-emerald-900 flex-1 min-w-[12rem]">
              <strong>{readyToSendCount}</strong> approach{" "}
              {readyToSendCount === 1 ? "pack is" : "packs are"} written and ready to send.
            </p>
            <Link href="/ready">
              <Button size="sm">Go to Ready to Send</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
              <SelectTrigger className="w-full sm:w-40">
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
              <SelectTrigger className="w-full sm:w-36">
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
                          {/* The row spans all 9 columns, so this cell is as wide as the
                              table — which is wider than the viewport. Left-pinning the
                              panel and capping its width keeps the action buttons on
                              screen instead of rendering them past the right edge. */}
                          <div className="sticky left-0 max-w-[calc(100vw-4rem)] md:max-w-[min(56rem,calc(100vw-23rem))] space-y-5">
                            {/* AI Intelligence Summary */}
                            <div>
                              <div className="flex flex-wrap items-center gap-3 mb-2">
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

                            {/* Approach Pack — find the agent + draft the seller approach */}
                            <div>
                              <div className="flex flex-wrap items-center gap-3 mb-2">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                                  <Users className="w-3 h-3" />Approach Pack — reach the agent to ask about selling
                                </p>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2.5 text-xs"
                                  onClick={() => handleFindContact(app.id, app.contactStatus === "found")}
                                  disabled={findingContactId === app.id}
                                >
                                  {findingContactId === app.id
                                    ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Researching</>
                                    : <><Search className="w-3 h-3 mr-1" />{app.contactStatus ? "Re-find contact" : "Find contact"}</>}
                                </Button>
                              </div>

                              {!app.contactStatus && (
                                <p className="text-sm text-muted-foreground italic">
                                  Click <strong>Find contact</strong> — AI reads the council page + searches the web for the agent/architect who filed this and their contact details.
                                </p>
                              )}

                              {app.contactStatus && (
                                <div className="bg-white border rounded-lg p-3 space-y-3">
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                                    <div><span className="text-muted-foreground">Agent:</span> <span className="font-medium">{app.agentName ?? "—"}</span></div>
                                    <div><span className="text-muted-foreground">Firm:</span> <span className="font-medium">{app.agentFirm ?? "—"}</span></div>
                                    <div>
                                      <span className="text-muted-foreground">Email:</span>{" "}
                                      {app.agentEmail
                                        ? <a href={`mailto:${app.agentEmail}`} className="font-medium text-blue-600 hover:underline">{app.agentEmail}</a>
                                        : <span className="text-muted-foreground">—</span>}
                                    </div>
                                    <div><span className="text-muted-foreground">Phone:</span> <span className="font-medium">{app.agentPhone ?? "—"}</span></div>
                                  </div>

                                  <div className="flex flex-wrap gap-2 text-xs">
                                    {app.agentWebsite && (
                                      <a href={app.agentWebsite.startsWith("http") ? app.agentWebsite : `https://${app.agentWebsite}`} target="_blank" rel="noreferrer" className="px-2 py-1 rounded border text-blue-600 hover:bg-blue-50">Firm website ↗</a>
                                    )}
                                    <a href={linkedinSearchUrl(app.agentName, app.agentFirm)} target="_blank" rel="noreferrer" className="px-2 py-1 rounded border text-blue-600 hover:bg-blue-50">LinkedIn search ↗</a>
                                    <a href={googleSearchUrl(app.agentName, app.agentFirm, app.council)} target="_blank" rel="noreferrer" className="px-2 py-1 rounded border text-blue-600 hover:bg-blue-50">Google search ↗</a>
                                    {app.councilUrl && (
                                      <a href={app.councilUrl} target="_blank" rel="noreferrer" className="px-2 py-1 rounded border text-blue-600 hover:bg-blue-50">Council page ↗</a>
                                    )}
                                  </div>

                                  {app.contactNotes && (
                                    <p className="text-xs text-muted-foreground border-t pt-2">{app.contactNotes}</p>
                                  )}

                                  {/* Seller-approach draft */}
                                  <div className="border-t pt-3">
                                    <div className="flex flex-wrap items-center gap-3 mb-2">
                                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Seller-approach email</p>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2.5 text-xs"
                                        onClick={() => handleDraftApproach(app.id, !!app.approachBody)}
                                        disabled={draftingApproachId === app.id}
                                      >
                                        {draftingApproachId === app.id
                                          ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Drafting</>
                                          : <><Mail className="w-3 h-3 mr-1" />{app.approachBody ? "Re-draft" : "Draft approach"}</>}
                                      </Button>
                                    </div>
                                    {app.approachBody ? (
                                      <div className="space-y-2">
                                        <p className="text-xs font-semibold">{app.approachSubject}</p>
                                        <p className="text-sm whitespace-pre-wrap bg-muted/40 rounded p-2">{app.approachBody}</p>
                                        <div className="flex flex-wrap gap-2">
                                          <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => navigator.clipboard.writeText(`${app.approachSubject}\n\n${app.approachBody}`)}>Copy</Button>
                                          {app.agentEmail && (
                                            <a href={`mailto:${app.agentEmail}?subject=${encodeURIComponent(app.approachSubject ?? "")}&body=${encodeURIComponent(app.approachBody ?? "")}`}>
                                              <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs">Open in email</Button>
                                            </a>
                                          )}
                                          {app.approachStatus !== "sent"
                                            ? <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => handleApproachState(app.id, { status: "sent" })}>Mark sent</Button>
                                            : (
                                              <div className="flex items-center gap-1.5">
                                                <span className="text-xs text-emerald-700 font-medium">Sent ✓ · outcome:</span>
                                                {(["replied", "interested", "won", "dead"] as const).map((o) => (
                                                  <button key={o} onClick={() => handleApproachState(app.id, { outcome: app.approachOutcome === o ? null : o })} className={`px-1.5 py-0.5 rounded text-xs border ${app.approachOutcome === o ? "bg-violet-100 text-violet-800 border-violet-300" : "text-muted-foreground hover:bg-muted"}`}>{o}</button>
                                                ))}
                                              </div>
                                            )}
                                        </div>
                                      </div>
                                    ) : (
                                      <p className="text-sm text-muted-foreground italic">No draft yet — click <strong>Draft approach</strong> to write the seller-approach email.</p>
                                    )}
                                  </div>
                                </div>
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
