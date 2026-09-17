"use client";

// Everything Lucy has sent or already approached, newest first. Answers her
// question "when I mark it as sent, where does it go?" — here — and is where she
// ticks off the agents who came back.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExternalLink, Inbox, MapPin, Search, Undo2 } from "lucide-react";
import { planningApplicationLink, councilReference } from "@/lib/planning-portals";
import {
  OUTCOME_OPTIONS,
  cameBack,
  formatSentDate,
  updateApproach,
  type ApproachChange,
} from "@/lib/approach-state";

interface SentLead {
  id: string;
  reference: string;
  lpaReference: string | null;
  council: string;
  address: string;
  units: number;
  councilUrl: string | null;
  mirrorUrl: string | null;
  agentName: string | null;
  agentFirm: string | null;
  agentEmail: string | null;
  agentPhone: string | null;
  approachBody: string | null;
  approachStatus: string | null;
  approachSentAt: string | null;
  approachOutcome: string | null;
}

type View = "all" | "waiting" | "came_back";

const VIEWS: ReadonlyArray<{ value: View; label: string }> = [
  { value: "all", label: "All" },
  { value: "waiting", label: "Waiting to hear" },
  { value: "came_back", label: "Came back to us" },
];

export default function SentPage() {
  const [leads, setLeads] = useState<SentLead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<View>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    const response = await fetch("/api/sourcing");
    const data = await response.json();
    const applications: SentLead[] = data.applications ?? [];
    setLeads(
      applications
        .filter((a) => a.approachStatus === "sent")
        .sort((a, b) => (b.approachSentAt ?? "").localeCompare(a.approachSentAt ?? ""))
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const handleChange = async (lead: SentLead, changes: ApproachChange) => {
    setSavingId(lead.id);
    await updateApproach(lead.id, changes);
    await fetchLeads();
    setSavingId(null);
  };

  const query = searchQuery.trim().toLowerCase();
  const visible = leads
    .filter((l) => (view === "all" ? true : view === "came_back" ? cameBack(l.approachOutcome) : !cameBack(l.approachOutcome)))
    .filter((l) =>
      query
        ? [l.address, l.council, l.agentName, l.agentFirm, l.agentEmail]
            .filter(Boolean)
            .some((f) => f!.toLowerCase().includes(query))
        : true
    );

  const cameBackCount = leads.filter((l) => cameBack(l.approachOutcome)).length;
  const interestedCount = leads.filter((l) => l.approachOutcome === "interested" || l.approachOutcome === "won").length;

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sent</h1>
        <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
          Every site you&rsquo;ve marked as sent or already approached, newest first. When an agent replies, tick{" "}
          <strong>Came back to us</strong> so you can see who&rsquo;s still to chase.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Sent", value: leads.length, color: "text-blue-600" },
          { label: "Waiting to hear", value: leads.length - cameBackCount, color: "text-amber-600" },
          { label: "Came back", value: cameBackCount, color: "text-violet-600" },
          { label: "Interested / deals", value: interestedCount, color: "text-emerald-600" },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="inline-flex rounded-lg border p-0.5 bg-muted/40 w-fit" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              role="tab"
              aria-selected={view === v.value}
              onClick={() => setView(v.value)}
              className={`px-3 py-1.5 text-sm rounded-md ${
                view === v.value ? "bg-white shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by address, council, agent..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <Inbox className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {leads.length === 0 ? (
                <>
                  Nothing sent yet. When you press <strong>Mark as sent</strong> on{" "}
                  <Link href="/ready" className="text-blue-600 hover:underline">Ready to Send</Link>, it moves here.
                </>
              ) : (
                "Nothing matches that filter."
              )}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((lead) => {
            const link = planningApplicationLink(lead);
            const contact = [lead.agentName, lead.agentFirm].filter(Boolean).join(" · ");
            return (
              <Card key={lead.id} className="max-w-4xl">
                <CardContent className="pt-4 pb-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm flex items-start gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <span>{lead.address}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {lead.council} · {lead.units} unit{lead.units === 1 ? "" : "s"} ·{" "}
                        <span className="font-mono">{councilReference(lead) ?? lead.reference}</span>
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground whitespace-nowrap">
                      Sent {formatSentDate(lead.approachSentAt)}
                    </p>
                  </div>

                  <div className="text-sm">
                    <span className="font-medium">{contact || "No contact recorded"}</span>
                    {lead.agentEmail && (
                      <>
                        {" · "}
                        <a href={`mailto:${lead.agentEmail}`} className="text-blue-600 hover:underline">
                          {lead.agentEmail}
                        </a>
                      </>
                    )}
                    {lead.agentPhone && <span className="text-muted-foreground"> · {lead.agentPhone}</span>}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                    {OUTCOME_OPTIONS.map((option) => {
                      const selected = lead.approachOutcome === option.value;
                      return (
                        <label
                          key={option.value}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border cursor-pointer select-none ${
                            selected ? option.className : "text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="accent-current"
                            checked={selected}
                            disabled={savingId === lead.id}
                            onChange={() => handleChange(lead, { outcome: selected ? null : option.value })}
                          />
                          {option.label}
                        </label>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline inline-flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      {link.label}
                    </a>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      disabled={savingId === lead.id}
                      onClick={() => handleChange(lead, { status: "not_sent" })}
                      title={lead.approachBody ? "Moves it back to Ready to Send" : "Marks it as not approached"}
                    >
                      <Undo2 className="w-3 h-3 mr-1" />
                      Not sent — undo
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
