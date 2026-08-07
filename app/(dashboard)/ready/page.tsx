"use client";

// Lucy's working queue. The Sourcing page shows all ~2,000 leads and buries the
// researched ones; this page shows ONLY the leads that have a named contact and a
// written approach email, so "who do I email today" is answered without hunting.
// Deliberately a narrow single-column list, not a wide table — the Sourcing table
// overflows horizontally and pushed its own action buttons off screen.

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RefreshCw, Search, MapPin, Mail, Copy, Check, ExternalLink,
  AlertTriangle, Send, Inbox,
} from "lucide-react";
import { isUsableEmail } from "@/lib/email-address";
import { planningApplicationLink, councilReference, mapUrl } from "@/lib/planning-portals";

interface ReadyLead {
  id: string;
  reference: string;
  lpaReference: string | null;
  council: string;
  address: string;
  units: number;
  status: string;
  leadScore: number | null;
  councilUrl: string | null;
  mirrorUrl: string | null;
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
}

const OUTCOMES = ["replied", "interested", "won", "dead"] as const;

function scoreBadgeClass(score: number | null): string {
  if (score == null) return "bg-gray-100 text-gray-500 border-gray-200";
  if (score >= 8) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (score >= 5) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function linkedinSearchUrl(name: string | null, firm: string | null): string {
  const q = [name, firm].filter(Boolean).join(" ");
  return `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(q || "planning consultant")}`;
}

function googleSearchUrl(name: string | null, firm: string | null, council: string): string {
  const q = [name, firm, name || firm ? "" : `${council} planning agent`, "contact email"]
    .filter(Boolean)
    .join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// Copies Lucy on every approach that goes out from here so she has a record of it.
// NEXT_PUBLIC_IDEALLAND_APPROACH_CC overrides; set it empty to stop copying.
function mailtoUrl(lead: ReadyLead): string {
  const params = new URLSearchParams({
    subject: lead.approachSubject ?? "",
    body: lead.approachBody ?? "",
  });
  const cc = (process.env.NEXT_PUBLIC_IDEALLAND_APPROACH_CC ?? "admin@idealland.co.uk").trim();
  if (cc) params.set("cc", cc);
  return `mailto:${lead.agentEmail}?${params}`;
}

export default function ReadyToSendPage() {
  const [leads, setLeads] = useState<ReadyLead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSent, setShowSent] = useState(false);

  const fetchLeads = useCallback(async () => {
    const response = await fetch("/api/sourcing");
    const data = await response.json();
    const applications: ReadyLead[] = data.applications ?? [];
    setLeads(
      applications
        .filter((a) => a.contactStatus === "found" && a.approachBody)
        .sort((a, b) => (b.leadScore ?? -1) - (a.leadScore ?? -1))
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const handleApproachState = async (
    appId: string,
    changes: { status?: string; outcome?: string | null }
  ) => {
    await fetch("/api/sourcing/approach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: appId, ...changes }),
    });
    await fetchLeads();
  };

  const handleCopy = async (lead: ReadyLead) => {
    await navigator.clipboard.writeText(`${lead.approachSubject ?? ""}\n\n${lead.approachBody ?? ""}`);
    setCopiedId(lead.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const matchesSearch = (lead: ReadyLead) =>
    searchQuery
      ? [lead.address, lead.council, lead.agentName, lead.agentFirm]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(searchQuery.toLowerCase()))
      : true;

  const visible = leads.filter(matchesSearch);
  const sent = visible.filter((l) => l.approachStatus === "sent");
  const pending = visible.filter((l) => l.approachStatus !== "sent");
  // A firm's generic inbox is fine; a guessed pattern like "firstname@firm.co.uk"
  // is not — those go to the lookup queue instead of offering a one-click send.
  const readyToEmail = pending.filter((l) => isUsableEmail(l.agentEmail));
  const needsLookup = pending.filter((l) => !isUsableEmail(l.agentEmail));

  const renderApproachEmail = (lead: ReadyLead) => (
    <div className="space-y-2">
      <p className="text-xs font-semibold">{lead.approachSubject}</p>
      <p className="text-sm whitespace-pre-wrap bg-muted/40 rounded p-3 leading-relaxed">
        {lead.approachBody}
      </p>
    </div>
  );

  const renderSiteHeader = (lead: ReadyLead) => (
    <div className="flex flex-wrap items-start gap-3">
      <span
        className={`inline-flex items-center justify-center min-w-[28px] h-6 rounded-full text-xs font-bold border shrink-0 ${scoreBadgeClass(lead.leadScore)}`}
        title="AI lead score out of 10"
      >
        {lead.leadScore ?? "—"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm flex items-start gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <span>{lead.address}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {lead.council} · {lead.units} unit{lead.units === 1 ? "" : "s"} · {lead.status} ·{" "}
          {/* The council's own ref, not our internal document id — this is the one
              that works in a planning search. */}
          <span className="font-mono">{councilReference(lead) ?? lead.reference}</span>
        </p>
      </div>
    </div>
  );

  const renderContactLine = (lead: ReadyLead) => (
    <div className="text-sm">
      <span className="font-medium">{lead.agentName ?? lead.agentFirm ?? "Contact"}</span>
      {lead.agentName && lead.agentFirm && (
        <span className="text-muted-foreground"> · {lead.agentFirm}</span>
      )}
      {lead.agentPhone && <span className="text-muted-foreground"> · {lead.agentPhone}</span>}
    </div>
  );

  const renderLookupLinks = (lead: ReadyLead) => (
    <div className="flex flex-wrap gap-2 text-xs">
      {lead.agentWebsite && (
        <a
          href={lead.agentWebsite.startsWith("http") ? lead.agentWebsite : `https://${lead.agentWebsite}`}
          target="_blank"
          rel="noreferrer"
          className="px-2 py-1 rounded border text-blue-600 hover:bg-blue-50"
        >
          Firm website ↗
        </a>
      )}
      <a
        href={linkedinSearchUrl(lead.agentName, lead.agentFirm)}
        target="_blank"
        rel="noreferrer"
        className="px-2 py-1 rounded border text-blue-600 hover:bg-blue-50"
      >
        LinkedIn search ↗
      </a>
      <a
        href={googleSearchUrl(lead.agentName, lead.agentFirm, lead.council)}
        target="_blank"
        rel="noreferrer"
        className="px-2 py-1 rounded border text-blue-600 hover:bg-blue-50"
      >
        Google search ↗
      </a>
      {/* Always offered — falls back to a pre-filled portal search, then a web
          search, when the GLA feed carries no direct link for this borough. */}
      <a
        href={planningApplicationLink(lead).url}
        target="_blank"
        rel="noreferrer"
        className="px-2 py-1 rounded border text-blue-600 hover:bg-blue-50"
      >
        {planningApplicationLink(lead).label} ↗
      </a>
      {mapUrl(lead.address, lead.council) && (
        <a
          href={mapUrl(lead.address, lead.council)!}
          target="_blank"
          rel="noreferrer"
          className="px-2 py-1 rounded border text-blue-600 hover:bg-blue-50"
        >
          See the property ↗
        </a>
      )}
    </div>
  );

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ready to Send</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Sites where we&rsquo;ve found the agent and written your approach email. Read it, send it,
          then mark it sent.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Ready to email", value: readyToEmail.length, color: "text-emerald-600" },
          { label: "Need an address", value: needsLookup.length, color: "text-amber-600" },
          { label: "Sent", value: sent.length, color: "text-blue-600" },
          {
            label: "Replies",
            value: leads.filter((l) => l.approachOutcome && l.approachOutcome !== "dead").length,
            color: "text-violet-600",
          },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by address, council, agent..."
          className="pl-9"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : leads.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <Inbox className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nothing ready yet. On the <strong>Sourcing</strong> page, open a lead and click{" "}
              <strong>Find contact</strong>, then <strong>Draft approach</strong> — it&rsquo;ll appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* Ready to email — one click opens the drafted mail */}
          {readyToEmail.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" />
                Ready to email ({readyToEmail.length})
              </h2>
              {readyToEmail.map((lead) => (
                <Card key={lead.id} className="max-w-4xl">
                  <CardContent className="pt-4 pb-4 space-y-3">
                    {renderSiteHeader(lead)}
                    <div className="border-t pt-3 space-y-2">
                      {renderContactLine(lead)}
                      <a
                        href={`mailto:${lead.agentEmail}`}
                        className="text-sm text-blue-600 hover:underline font-medium"
                      >
                        {lead.agentEmail}
                      </a>
                      {renderApproachEmail(lead)}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <a href={mailtoUrl(lead)}>
                          <Button size="sm">
                            <Mail className="w-3.5 h-3.5 mr-1.5" />
                            Open in email
                          </Button>
                        </a>
                        <Button size="sm" variant="outline" onClick={() => handleCopy(lead)}>
                          {copiedId === lead.id ? (
                            <><Check className="w-3.5 h-3.5 mr-1.5" />Copied</>
                          ) : (
                            <><Copy className="w-3.5 h-3.5 mr-1.5" />Copy</>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleApproachState(lead.id, { status: "sent" })}
                        >
                          <Send className="w-3.5 h-3.5 mr-1.5" />
                          Mark sent
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </section>
          )}

          {/* Contact found, but no address we can safely mail */}
          {needsLookup.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Need an email address ({needsLookup.length})
              </h2>
              <p className="text-sm text-muted-foreground max-w-4xl">
                We know the firm and the email is written — we just couldn&rsquo;t confirm an address.
                Use the links to find one, then send the draft below.
              </p>
              {needsLookup.map((lead) => (
                <Card key={lead.id} className="max-w-4xl">
                  <CardContent className="pt-4 pb-4 space-y-3">
                    {renderSiteHeader(lead)}
                    <div className="border-t pt-3 space-y-2">
                      {renderContactLine(lead)}
                      {renderLookupLinks(lead)}
                      {lead.contactNotes && (
                        <p className="text-xs text-muted-foreground border-t pt-2">{lead.contactNotes}</p>
                      )}
                      {renderApproachEmail(lead)}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="sm" variant="outline" onClick={() => handleCopy(lead)}>
                          {copiedId === lead.id ? (
                            <><Check className="w-3.5 h-3.5 mr-1.5" />Copied</>
                          ) : (
                            <><Copy className="w-3.5 h-3.5 mr-1.5" />Copy email text</>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleApproachState(lead.id, { status: "sent" })}
                        >
                          <Send className="w-3.5 h-3.5 mr-1.5" />
                          Mark sent
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </section>
          )}

          {/* Already sent — collapsed by default, this is the follow-up list */}
          {sent.length > 0 && (
            <section className="space-y-3">
              <button
                onClick={() => setShowSent(!showSent)}
                className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 hover:text-foreground"
              >
                <Check className="w-3.5 h-3.5" />
                Sent ({sent.length}) — {showSent ? "hide" : "show"}
              </button>
              {showSent &&
                sent.map((lead) => (
                  <Card key={lead.id} className="max-w-4xl">
                    <CardContent className="pt-4 pb-4 space-y-3">
                      {renderSiteHeader(lead)}
                      <div className="border-t pt-3 space-y-2">
                        {renderContactLine(lead)}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-emerald-700 font-medium">Sent ✓ · outcome:</span>
                          {OUTCOMES.map((outcome) => (
                            <button
                              key={outcome}
                              onClick={() =>
                                handleApproachState(lead.id, {
                                  outcome: lead.approachOutcome === outcome ? null : outcome,
                                })
                              }
                              className={`px-2 py-0.5 rounded text-xs border ${
                                lead.approachOutcome === outcome
                                  ? "bg-violet-100 text-violet-800 border-violet-300"
                                  : "text-muted-foreground hover:bg-muted"
                              }`}
                            >
                              {outcome}
                            </button>
                          ))}
                        </div>
                        {(
                          <a
                            href={planningApplicationLink(lead).url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                          >
                            <ExternalLink className="w-3 h-3" />
                            {planningApplicationLink(lead).label}
                          </a>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </section>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <RefreshCw className="w-3 h-3" />
        Nothing is ever emailed automatically — you send every one yourself.
      </p>
    </div>
  );
}
