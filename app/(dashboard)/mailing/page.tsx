"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, Plus, Send, Mail, Users, BarChart3 } from "lucide-react";

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

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sending: "bg-yellow-100 text-yellow-800",
  sent: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

const TYPE_COLORS: Record<string, string> = {
  developer: "bg-blue-100 text-blue-800",
  architect: "bg-purple-100 text-purple-800",
  investor: "bg-orange-100 text-orange-800",
};

export default function MailingPage() {
  const [campaigns, setCampaigns] = useState<MailingCampaign[]>([]);
  const [contacts, setContacts] = useState<MailingContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const fetchData = useCallback(async () => {
    const [campaignsRes, contactsRes] = await Promise.all([
      fetch("/api/mailing?view=campaigns"),
      fetch("/api/mailing?view=contacts"),
    ]);
    const [campaignsData, contactsData] = await Promise.all([
      campaignsRes.json(),
      contactsRes.json(),
    ]);
    setCampaigns(campaignsData.campaigns);
    setContacts(contactsData.contacts);
    setIsLoading(false);
  }, []);

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
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
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

      <div className="grid grid-cols-4 gap-4">
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

      <Tabs defaultValue="campaigns">
        <TabsList>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="contacts">Contacts ({contacts.length})</TabsTrigger>
        </TabsList>

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
                    <div className="grid grid-cols-3 gap-4 mb-3">
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
