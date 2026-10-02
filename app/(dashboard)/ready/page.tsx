"use client";

// Lucy's working queue. The Sourcing page shows all ~2,000 leads and buries the
// researched ones; this page shows ONLY the leads that have a named contact and a
// written approach email, so "who do I email today" is answered without hunting.
// Deliberately a narrow single-column list, not a wide table — the Sourcing table
// overflows horizontally and pushed its own action buttons off screen.

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RefreshCw, Search, MapPin, Mail, Copy, Check,
  AlertTriangle, Send, Inbox, CheckCheck, Undo2,
} from "lucide-react";
import { isUsableEmail } from "@/lib/email-address";
import { planningApplicationLink, councilReference, mapUrl } from "@/lib/planning-portals";
import { addressLooksIncomplete, approachMailto, refreshGreeting } from "@/lib/approach-email";
import { isCoveredCouncil } from "@/lib/coverage";
import { cameBack, contactSource, formatSentDate, updateApproach, type ApproachChange } from "@/lib/approach-state";
import { EditContact, LeadNote } from "@/components/lead-notes";
import { freshLabel, freshPermissionAge } from "@/lib/fresh-permission";

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
  approachSentAt: string | null;
  approachOutcome: string | null;
  staffNote: string | null;
  followUpAt: string | null;
  publicOwner: boolean;
  decision: string | null;
  decidedAt: string | null;
}

function scoreBadgeClass(score: number | null): string {
  if (score == null) return "bg-gray-100 text-gray-500 border-gray-200";
  if (score >= 8) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (score >= 5) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

/** The same agent, by inbox or practice, so a second site can go in one letter. */
function agentKey(lead: ReadyLead): string | null {
  const email = lead.agentEmail?.trim().toLowerCase();
  if (email) return email;
  const firm = lead.agentFirm?.toLowerCase().replace(/\b(ltd|limited|llp)\b/g, "").replace(/[^a-z0-9]/g, "");
  return firm || null;
}

function sentLettersByAgent(applications: ReadyLead[]): Map<string, ReadyLead[]> {
  const byAgent = new Map<string, ReadyLead[]>();
  for (const a of applications) {
    const key = a.approachStatus === "sent" ? agentKey(a) : null;
    if (key) byAgent.set(key, [...(byAgent.get(key) ?? []), a]);
  }
  return byAgent;
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


export default function ReadyToSendPage() {
  const [leads, setLeads] = useState<ReadyLead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sentByAgent, setSentByAgent] = useState<Map<string, ReadyLead[]>>(new Map());
  // The last site moved to Sent, so a mis-click can be undone from right here.
  const [lastSent, setLastSent] = useState<ReadyLead | null>(null);

  const fetchLeads = useCallback(async () => {
    const response = await fetch("/api/sourcing");
    const data = await response.json();
    const applications: ReadyLead[] = data.applications ?? [];
    setLeads(
      applications
        .filter((a) => a.contactStatus === "found" && a.approachBody)
        // Fresh permissions first, newest first; then by score.
        .sort((a, b) => {
          const fa = freshPermissionAge(a);
          const fb = freshPermissionAge(b);
          if (fa !== null || fb !== null) return (fa ?? Infinity) - (fb ?? Infinity);
          return (b.leadScore ?? -1) - (a.leadScore ?? -1);
        })
    );
    setSentByAgent(sentLettersByAgent(applications));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const handleApproachState = async (lead: ReadyLead, changes: ApproachChange) => {
    await updateApproach(lead.id, changes);
    setLastSent(changes.status === "sent" ? lead : null);
    await fetchLeads();
  };

  const handleCopy = async (lead: ReadyLead) => {
    await navigator.clipboard.writeText(`${lead.approachSubject ?? ""}\n\n${refreshGreeting(lead.approachBody)}`);
    setCopiedId(lead.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const matchesSearch = (lead: ReadyLead) =>
    searchQuery
      ? [lead.address, lead.council, lead.agentName, lead.agentFirm, lead.staffNote]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(searchQuery.toLowerCase()))
      : true;

  const visible = leads.filter(matchesSearch);
  const sentCount = leads.filter((l) => l.approachStatus === "sent").length;
  // Outside Lucy's areas nothing is left to send — those letters live on the Sent page.
  // Council-owned land can't be brokered, so it never reaches the to-send list.
  const pending = visible.filter(
    (l) => l.approachStatus !== "sent" && isCoveredCouncil(l.council) && !l.publicOwner
  );
  // Several applications on one site (Betchworth House has six) usually mean one
  // letter to the agent, not six.
  const lettersAtAddress = new Map<string, number>();
  for (const l of pending) {
    const key = l.address.toLowerCase().replace(/[^a-z0-9]/g, "");
    lettersAtAddress.set(key, (lettersAtAddress.get(key) ?? 0) + 1);
  }
  const sameSiteCount = (lead: ReadyLead) =>
    (lettersAtAddress.get(lead.address.toLowerCase().replace(/[^a-z0-9]/g, "")) ?? 1) - 1;
  // A firm's generic inbox is fine; a guessed pattern like "firstname@firm.co.uk"
  // is not — those go to the lookup queue instead of offering a one-click send.
  const readyToEmail = pending.filter((l) => isUsableEmail(l.agentEmail));
  const needsLookup = pending.filter((l) => !isUsableEmail(l.agentEmail));

  const renderApproachEmail = (lead: ReadyLead) => (
    <div className="space-y-2">
      <p className="text-xs font-semibold">{lead.approachSubject}</p>
      <p className="text-sm whitespace-pre-wrap bg-muted/40 rounded p-3 leading-relaxed">
        {refreshGreeting(lead.approachBody)}
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
        {freshPermissionAge(lead) !== null && (
          <p className="mb-1">
            <span className="inline-flex items-center rounded-full bg-emerald-600 text-white text-xs font-semibold px-2 py-0.5">
              New permission — {freshLabel(freshPermissionAge(lead)!)}
            </span>
          </p>
        )}
        <p className="font-medium text-sm flex items-start gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <span>{lead.address}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {lead.council} · {lead.units} unit{lead.units === 1 ? "" : "s"} ·{" "}
          {lead.status === "decided" && lead.decision ? (
            <span className={/approv|grant|permit/i.test(lead.decision) ? "text-emerald-700" : "text-red-700 font-semibold"}>
              {lead.decision}
              {lead.decidedAt && ` ${formatSentDate(lead.decidedAt)}`}
            </span>
          ) : (
            lead.status
          )}{" "}
          ·{" "}
          {/* The council's own ref, not our internal document id — this is the one
              that works in a planning search. */}
          <a
            href={planningApplicationLink(lead).url}
            target="_blank"
            rel="noreferrer"
            title={planningApplicationLink(lead).hint}
            className="font-mono text-blue-600 hover:underline"
          >
            {councilReference(lead) ?? lead.reference} ↗
          </a>
        </p>
      </div>
    </div>
  );

  const renderContactLine = (lead: ReadyLead) => {
    const source = contactSource(lead.contactNotes);
    const others = sameSiteCount(lead);
    // Reigate files the practice under "Agent Name"; that isn't a person.
    const person = lead.agentName && lead.agentName !== lead.agentFirm ? lead.agentName : null;
    return (
      <div className="space-y-1.5">
        <div className="text-sm">
          <span className="font-medium">{person ?? lead.agentFirm ?? "Contact"}</span>
          {person && lead.agentFirm && <span className="text-muted-foreground"> · {lead.agentFirm}</span>}
          {lead.agentPhone && <span className="text-muted-foreground"> · {lead.agentPhone}</span>}
        </div>
        {source === "register" && person && (
          <p className="text-xs text-emerald-700">✓ Agent taken from the council&rsquo;s planning register</p>
        )}
        {source === "register" && !person && (
          <p className="text-xs text-emerald-700">
            ✓ Firm taken from the council&rsquo;s planning register — it doesn&rsquo;t name the person, so the
            letter opens &ldquo;Good morning/afternoon&rdquo;. If you know who it is, use <strong>Edit contact</strong>.
          </p>
        )}
        {source === "lucy" && <p className="text-xs text-emerald-700">✓ Contact entered by you</p>}
        {source === "web" && (
          <p className="text-xs rounded border border-amber-300 bg-amber-50 text-amber-900 px-2 py-1">
            Found by web search — the council register doesn&rsquo;t show the agent for this one. Check the
            application before sending; if the agent is different, use <strong>Edit contact</strong>.
          </p>
        )}
        {addressLooksIncomplete(lead.address) && (
          <p className="text-xs rounded border border-amber-300 bg-amber-50 text-amber-900 px-2 py-1">
            The council data only gives &ldquo;{lead.address}&rdquo; as the address — check the application and
            add the house number or site name in your email before sending.
          </p>
        )}
        {(() => {
          const key = agentKey(lead);
          const earlier = key ? sentByAgent.get(key) ?? [] : [];
          if (earlier.length === 0) return null;
          return (
            <p className="text-xs text-blue-700">
              You&rsquo;ve already written to this agent about{" "}
              {earlier
                .slice(0, 3)
                .map((e) => `${e.address} (${formatSentDate(e.approachSentAt)})`)
                .join("; ")}
              {earlier.length > 3 && ` and ${earlier.length - 3} more`}.
            </p>
          );
        })()}
        {others > 0 && (
          <p className="text-xs text-blue-700">
            {others} other letter{others === 1 ? "" : "s"} waiting for this same address — you may want to send just one.
          </p>
        )}
      </div>
    );
  };

  const renderLucyTools = (lead: ReadyLead) => (
    <div className="space-y-1.5">
      <LeadNote key={`n-${lead.id}-${lead.staffNote}-${lead.followUpAt}`} lead={lead} onSaved={fetchLeads} />
      <EditContact key={`c-${lead.id}-${lead.agentName}-${lead.agentEmail}`} lead={lead} onSaved={fetchLeads} />
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
          then press <strong>Mark as sent</strong> — it moves to the{" "}
          <Link href="/sent" className="text-blue-600 hover:underline">Sent</Link> page. If you&rsquo;ve
          already written to them another way, press <strong>Already approached</strong>.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Ready to email", value: readyToEmail.length, color: "text-emerald-600" },
          { label: "Need an address", value: needsLookup.length, color: "text-amber-600" },
          { label: "Sent", value: sentCount, color: "text-blue-600" },
          {
            label: "Came back",
            value: leads.filter((l) => cameBack(l.approachOutcome)).length,
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

      {lastSent && (
        <Card className="border-blue-200 bg-blue-50 max-w-4xl">
          <CardContent className="py-3 flex flex-wrap items-center gap-3">
            <CheckCheck className="w-4 h-4 text-blue-600 shrink-0" />
            <p className="text-sm text-blue-900 flex-1 min-w-[12rem]">
              <strong>{lastSent.address}</strong> moved to{" "}
              <Link href="/sent" className="underline">Sent</Link>.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await updateApproach(lastSent.id, { status: "not_sent" });
                setLastSent(null);
                await fetchLeads();
              }}
            >
              <Undo2 className="w-3.5 h-3.5 mr-1.5" />
              Undo
            </Button>
          </CardContent>
        </Card>
      )}

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
      ) : pending.length === 0 && !searchQuery ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <Inbox className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nothing waiting to send. New contacts are researched every morning, or on the{" "}
              <strong>Sourcing</strong> page open a lead and click <strong>Find contact</strong>, then{" "}
              <strong>Draft approach</strong> — it&rsquo;ll appear here.
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
                      {contactSource(lead.contactNotes) === "web" && lead.contactNotes && (
                        <p className="text-xs text-muted-foreground border-t pt-2">{lead.contactNotes}</p>
                      )}
                      {renderLucyTools(lead)}
                      {renderApproachEmail(lead)}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <a href={approachMailto(lead.agentEmail ?? "", lead.approachSubject, lead.approachBody)}>
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
                          onClick={() => handleApproachState(lead, { status: "sent" })}
                        >
                          <Send className="w-3.5 h-3.5 mr-1.5" />
                          Mark as sent
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground"
                          onClick={() => handleApproachState(lead, { status: "sent" })}
                          title="You've already written to or spoken with them — moves it to Sent without emailing"
                        >
                          Already approached
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
                      {renderLucyTools(lead)}
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
                          onClick={() => handleApproachState(lead, { status: "sent" })}
                        >
                          <Send className="w-3.5 h-3.5 mr-1.5" />
                          Mark as sent
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground"
                          onClick={() => handleApproachState(lead, { status: "sent" })}
                          title="You've already written to or spoken with them — moves it to Sent without emailing"
                        >
                          Already approached
                        </Button>
                      </div>
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
        Nothing is ever emailed automatically — you send every one yourself. Sent ones are on the{" "}
        <Link href="/sent" className="text-blue-600 hover:underline">Sent</Link> page.
      </p>
    </div>
  );
}
