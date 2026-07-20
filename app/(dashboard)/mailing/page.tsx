"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Plus, Send, Mail, Users, BarChart3, Sparkles, Check, AlertCircle } from "lucide-react";

interface MailingCampaign {
  id: string;
  subject: string;
  status: string;
  recipientCount: number;
  openCount: number;
  clickCount: number;
  sentAt: string | null;
  createdAt: string;
  _count: { recipients: number };
}

interface MailingContact {
  id: string;
  name: string;
  email: string;
  company: string | null;
  type: string;
  tags: string;
  active: boolean;
  createdAt: string;
}

interface OutreachEmail {
  id: string;
  applicationId: string;
  contactEmail: string;
  contactName: string;
  subject: string;
  body: string;
  status: string;
  outcome: string | null;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  application: {
    id: string;
    reference: string;
    council: string;
    address: string;
    units: number;
  };
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sending: "bg-yellow-100 text-yellow-800",
  sent: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

// What came back after a send. Distinct from status, which only says whether
// the email left the building.
const OUTCOMES = ["replied", "interested", "dead", "closed-won"] as const;

const OUTCOME_COLORS: Record<string, string> = {
  replied: "bg-blue-100 text-blue-800",
  interested: "bg-violet-100 text-violet-800",
  dead: "bg-gray-100 text-gray-600",
  "closed-won": "bg-emerald-100 text-emerald-800",
};

// The Select uses a sentinel rather than "" because an empty string is not a
// selectable value in this Select implementation.
const NO_OUTCOME = "none";

const TYPE_COLORS: Record<string, string> = {
  developer: "bg-blue-100 text-blue-800",
  architect: "bg-purple-100 text-purple-800",
  investor: "bg-orange-100 text-orange-800",
};

export default function MailingPage() {
  const [campaigns, setCampaigns] = useState<MailingCampaign[]>([]);
  const [contacts, setContacts] = useState<MailingContact[]>([]);
  const [outreach, setOutreach] = useState<OutreachEmail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState<string | null>(null);
  const [sendingOutreachId, setSendingOutreachId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const fetchData = useCallback(async () => {
    const [campaignsRes, contactsRes, outreachRes] = await Promise.all([
      fetch("/api/mailing?view=campaigns"),
      fetch("/api/mailing?view=contacts"),
      fetch("/api/outreach"),
    ]);
    const [campaignsData, contactsData, outreachData] = await Promise.all([
      campaignsRes.json(),
      contactsRes.json(),
      outreachRes.json(),
    ]);
    setCampaigns(campaignsData.campaigns);
    setContacts(contactsData.contacts);
    setOutreach(outreachData.outreach ?? []);
    setIsLoading(false);
  }, []);

  const [isBulkDrafting, setIsBulkDrafting] = useState(false);

  const handleBulkDraft = async () => {
    setIsBulkDrafting(true);
    try {
      const response = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bulk: true, limit: 10 }),
      });
      const result = await response.json();
      if (result.reason && result.drafted === 0) {
        alert(result.reason);
      } else {
        alert(`Drafted ${result.drafted} email(s) across ${result.appsProcessed} top lead(s).`);
      }
      await fetchData();
    } finally {
      setIsBulkDrafting(false);
    }
  };

  const handleSendOutreach = async (outreachId: string) => {
    setSendingOutreachId(outreachId);
    const response = await fetch(`/api/outreach/${outreachId}/send`, { method: "POST" });
    const result = await response.json();
    if (!result.ok) {
      alert(`Send failed: ${result.reason ?? "unknown error"}`);
    }
    await fetchData();
    setSendingOutreachId(null);
  };

  const handleSetOutcome = async (outreachId: string, value: string) => {
    const outcome = value === NO_OUTCOME ? null : value;
    const response = await fetch(`/api/outreach/${outreachId}/outcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome }),
    });
    const result = await response.json();
    if (!result.ok) {
      alert(`Could not record outcome: ${result.reason ?? result.error ?? "unknown error"}`);
      return;
    }
    await fetchData();
  };

  // Group outreach drafts by application so staff sees them per opportunity.
  const outreachByApp = outreach.reduce<Record<string, OutreachEmail[]>>((acc, email) => {
    const key = email.applicationId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(email);
    return acc;
  }, {});

  const pendingOutreachCount = outreach.filter((o) => o.status === "draft").length;

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSend = async (campaignId: string) => {
    setIsSending(campaignId);
    await fetch("/api/mailing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send", campaignId }),
    });
    await fetchData();
    setIsSending(null);
  };

  const handleCreateCampaign = async () => {
    setIsCreating(true);
    await fetch("/api/mailing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: `New London Development Opportunities — ${new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`,
        content: `Dear {name},\n\nIdealLand has identified new planning applications across London this week. Our automated sourcing system has flagged opportunities across multiple boroughs.\n\nContact us to discuss these opportunities.\n\nBest regards,\nThe IdealLand Team`,
        recipientTypes: ["developer", "architect", "investor"],
      }),
    });
    await fetchData();
    setIsCreating(false);
  };

  const totalSent = campaigns.reduce((sum, c) => sum + (c.status === "sent" ? c.recipientCount : 0), 0);
  const totalOpens = campaigns.reduce((sum, c) => sum + c.openCount, 0);
  const avgOpenRate = totalSent > 0 ? (totalOpens / totalSent) * 100 : 0;

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mailing Automation</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Personalised property emails to your developer and architect mailing list
          </p>
        </div>
        <Button onClick={handleCreateCampaign} disabled={isCreating}>
          {isCreating ? (
            <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Creating...</>
          ) : (
            <><Plus className="w-4 h-4 mr-2" />New Campaign</>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Active Contacts", value: contacts.filter((c) => c.active).length, icon: Users },
          { label: "Campaigns Sent", value: campaigns.filter((c) => c.status === "sent").length, icon: Mail },
          { label: "Emails Delivered", value: totalSent, icon: Send },
          { label: "Avg Open Rate", value: `${avgOpenRate.toFixed(0)}%`, icon: BarChart3 },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="text-2xl font-bold">{value}</p>
                </div>
                <Icon className="w-5 h-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue={pendingOutreachCount > 0 ? "outreach" : "campaigns"}>
        <TabsList className="w-full overflow-x-auto">
          <TabsTrigger value="outreach">
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            AI Outreach Drafts {pendingOutreachCount > 0 && `(${pendingOutreachCount})`}
          </TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="contacts">Contacts ({contacts.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="outreach" className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground">
              Personalised cold emails drafted for the highest-scored leads. Review, then send.
            </p>
            <Button size="sm" onClick={handleBulkDraft} disabled={isBulkDrafting}>
              <Sparkles className={`w-4 h-4 mr-2 ${isBulkDrafting ? "animate-pulse" : ""}`} />
              {isBulkDrafting ? "Drafting…" : "Draft outreach for top 10 leads"}
            </Button>
          </div>
          {Object.keys(outreachByApp).length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Sparkles className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  No outreach drafts yet. Click <strong>Draft outreach for top 10 leads</strong> above to auto-generate personalised cold emails for your best-scored opportunities.
                </p>
              </CardContent>
            </Card>
          ) : (
            Object.entries(outreachByApp).map(([appId, emails]) => {
              const app = emails[0].application;
              const pending = emails.filter((e) => e.status === "draft").length;
              const sent = emails.filter((e) => e.status === "sent").length;
              return (
                <Card key={appId}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{app.address}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">
                          {app.council} · {app.units} units · {app.reference}
                        </p>
                      </div>
                      <div className="flex gap-2 text-xs">
                        {pending > 0 && <Badge className="bg-amber-100 text-amber-800 border-0">{pending} pending</Badge>}
                        {sent > 0 && <Badge className="bg-green-100 text-green-800 border-0">{sent} sent</Badge>}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {emails.map((email) => (
                        <div key={email.id} className="border rounded-lg p-3 bg-card">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold truncate">{email.subject}</p>
                              <p className="text-xs text-muted-foreground">
                                To: {email.contactName} &lt;{email.contactEmail}&gt;
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {email.status === "draft" && (
                                <Button
                                  size="sm"
                                  className="h-7 px-2.5 text-xs"
                                  onClick={() => handleSendOutreach(email.id)}
                                  disabled={sendingOutreachId === email.id}
                                >
                                  {sendingOutreachId === email.id
                                    ? <RefreshCw className="w-3 h-3 animate-spin" />
                                    : <><Send className="w-3 h-3 mr-1" />Send</>}
                                </Button>
                              )}
                              {email.status === "sent" && (
                                <>
                                  <Badge className="bg-green-100 text-green-800 border-0 text-xs">
                                    <Check className="w-3 h-3 mr-0.5" />sent
                                  </Badge>
                                  <Select
                                    value={email.outcome ?? NO_OUTCOME}
                                    onValueChange={(v) => handleSetOutcome(email.id, v ?? NO_OUTCOME)}
                                  >
                                    <SelectTrigger
                                      className={`h-7 w-32 text-xs ${email.outcome ? OUTCOME_COLORS[email.outcome] ?? "" : ""}`}
                                      aria-label={`Outcome for email to ${email.contactName}`}
                                    >
                                      <SelectValue placeholder="No outcome" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value={NO_OUTCOME}>No outcome</SelectItem>
                                      {OUTCOMES.map((o) => (
                                        <SelectItem key={o} value={o}>{o}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </>
                              )}
                              {email.status === "failed" && (
                                <Badge className="bg-red-100 text-red-800 border-0 text-xs" title={email.errorMessage ?? ""}>
                                  <AlertCircle className="w-3 h-3 mr-0.5" />failed
                                </Badge>
                              )}
                            </div>
                          </div>
                          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed bg-muted/50 rounded p-2">{email.body}</pre>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="campaigns" className="mt-4 space-y-4">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-32 bg-muted rounded-xl animate-pulse" />
            ))
          ) : campaigns.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Mail className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No campaigns yet. Add contacts and create your first campaign.</p>
              </CardContent>
            </Card>
          ) : (
            campaigns.map((campaign) => {
              const openRate = campaign.recipientCount > 0 ? (campaign.openCount / campaign.recipientCount) * 100 : 0;
              const clickRate = campaign.recipientCount > 0 ? (campaign.clickCount / campaign.recipientCount) * 100 : 0;
              return (
                <Card key={campaign.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{campaign.subject}</CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge className={`text-xs ${STATUS_COLORS[campaign.status]}`} variant="outline">
                          {campaign.status}
                        </Badge>
                        {campaign.status === "draft" && (
                          <Button
                            size="sm"
                            onClick={() => handleSend(campaign.id)}
                            disabled={isSending === campaign.id}
                          >
                            {isSending === campaign.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <><Send className="w-3.5 h-3.5 mr-1.5" />Send</>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-3">
                      {[
                        { label: "Recipients", value: campaign.recipientCount },
                        { label: "Opens", value: `${campaign.openCount} (${openRate.toFixed(0)}%)` },
                        { label: "Clicks", value: `${campaign.clickCount} (${clickRate.toFixed(0)}%)` },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <p className="text-xs text-muted-foreground">{label}</p>
                          <p className="text-base font-semibold">{value}</p>
                        </div>
                      ))}
                    </div>
                    {campaign.status === "sent" && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Open rate</span>
                          <span>{openRate.toFixed(0)}%</span>
                        </div>
                        <Progress value={openRate} className="h-1.5" />
                      </div>
                    )}
                    {campaign.sentAt && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Sent {new Date(campaign.sentAt).toLocaleString("en-GB")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="contacts" className="mt-4">
          <Card>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Tags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell className="font-medium text-sm">{contact.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{contact.email}</TableCell>
                      <TableCell className="text-sm">{contact.company ?? "—"}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[contact.type] ?? "bg-gray-100"}`}>
                          {contact.type}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {contact.tags.split(",").filter(Boolean).map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag.trim()}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
