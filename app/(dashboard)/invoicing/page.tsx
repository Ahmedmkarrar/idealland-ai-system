"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Plus, Send, Receipt, Users, AlertCircle } from "lucide-react";

interface ClientRow {
  id: string;
  name: string;
  email: string;
  billingEmail: string | null;
  billingModel: string;
  monthlyRate: number | null;
  perUnitRate: number | null;
  currency: string;
  status: string;
  notes: string | null;
  _count?: { invoices: number };
}

interface InvoiceRow {
  id: string;
  clientId: string;
  client: ClientRow;
  periodStart: string;
  periodEnd: string;
  amount: number;
  currency: string;
  status: string;
  sentAt: string | null;
  paidAt: string | null;
  dueDate: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
  void: "bg-slate-100 text-slate-500",
  active: "bg-green-100 text-green-800",
  paused: "bg-amber-100 text-amber-800",
  cancelled: "bg-slate-100 text-slate-500",
};

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatPeriod(start: string): string {
  return new Date(start).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

export default function InvoicingPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [xeroConfigured, setXeroConfigured] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClient, setNewClient] = useState({
    name: "",
    email: "",
    billingEmail: "",
    billingModel: "flat_monthly",
    monthlyRate: "",
    currency: "GBP",
    notes: "",
  });

  const refresh = useCallback(async () => {
    const [clientsRes, invoicesRes] = await Promise.all([
      fetch("/api/invoicing/clients"),
      fetch("/api/invoicing"),
    ]);
    const clientsData = await clientsRes.json();
    const invoicesData = await invoicesRes.json();
    setClients(clientsData.clients ?? []);
    setInvoices(invoicesData.invoices ?? []);
    setXeroConfigured(invoicesData.xeroConfigured ?? false);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAddClient = async () => {
    const payload = {
      ...newClient,
      monthlyRate: newClient.monthlyRate ? Number(newClient.monthlyRate) : undefined,
    };
    const res = await fetch("/api/invoicing/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setShowAddClient(false);
      setNewClient({ name: "", email: "", billingEmail: "", billingModel: "flat_monthly", monthlyRate: "", currency: "GBP", notes: "" });
      await refresh();
    } else {
      const { error } = await res.json();
      alert(`Failed: ${error}`);
    }
  };

  const handleGenerateMonth = async () => {
    setIsGenerating(true);
    const res = await fetch("/api/invoicing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate" }),
    });
    const result = await res.json();
    if (result.created > 0) {
      alert(`Generated ${result.created} invoice(s) for ${result.period}. ${result.skipped > 0 ? `${result.skipped} skipped (already exist).` : ""}`);
    } else if (result.skipped > 0) {
      alert(`No new invoices. ${result.skipped} client(s) already invoiced this period.`);
    } else {
      alert("No active flat_monthly clients to invoice. Add one first.");
    }
    await refresh();
    setIsGenerating(false);
  };

  const handleSend = async (invoiceId: string) => {
    setSendingId(invoiceId);
    const res = await fetch(`/api/invoicing/${invoiceId}/send`, { method: "POST" });
    const result = await res.json();
    if (result.ok && !xeroConfigured) {
      alert(`Marked sent locally. ${result.reason}`);
    }
    await refresh();
    setSendingId(null);
  };

  if (isLoading) {
    return <div className="p-8"><p className="text-muted-foreground">Loading invoicing…</p></div>;
  }

  const totalOutstanding = invoices
    .filter((i) => i.status === "sent" || i.status === "overdue")
    .reduce((sum, i) => sum + i.amount, 0);
  const totalThisMonth = invoices
    .filter((i) => {
      const now = new Date();
      const periodStart = new Date(i.periodStart);
      return periodStart.getMonth() === now.getMonth() && periodStart.getFullYear() === now.getFullYear();
    })
    .reduce((sum, i) => sum + i.amount, 0);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoicing</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Monthly auto-billing for IdealLand&apos;s clients{xeroConfigured ? "" : " (Xero not configured — invoices mark sent locally)"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={refresh} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />Refresh
          </Button>
          <Button onClick={handleGenerateMonth} disabled={isGenerating} size="sm">
            {isGenerating ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Generating…</> : <><Receipt className="w-4 h-4 mr-2" />Generate This Month</>}
          </Button>
        </div>
      </div>

      {!xeroConfigured && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm text-amber-900">
              Xero isn&apos;t connected yet. Invoices generate and can be marked &ldquo;sent&rdquo; locally, but they won&apos;t hit Xero or the client&apos;s email until <code className="text-xs bg-white px-1 rounded">XERO_CLIENT_ID</code> and <code className="text-xs bg-white px-1 rounded">XERO_CLIENT_SECRET</code> are added to <code className="text-xs bg-white px-1 rounded">.env.local</code> (create the app at <a className="underline" href="https://developer.xero.com" target="_blank" rel="noreferrer">developer.xero.com</a>).
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Active Clients</p>
            <p className="text-2xl font-bold mt-1">{clients.filter((c) => c.status === "active").length}</p>
            <p className="text-xs text-muted-foreground mt-1">{clients.length} total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">This Month</p>
            <p className="text-2xl font-bold mt-1">{formatMoney(totalThisMonth, "GBP")}</p>
            <p className="text-xs text-muted-foreground mt-1">{invoices.filter((i) => {
              const now = new Date();
              const periodStart = new Date(i.periodStart);
              return periodStart.getMonth() === now.getMonth() && periodStart.getFullYear() === now.getFullYear();
            }).length} invoice(s)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Outstanding</p>
            <p className="text-2xl font-bold mt-1">{formatMoney(totalOutstanding, "GBP")}</p>
            <p className="text-xs text-muted-foreground mt-1">{invoices.filter((i) => i.status === "sent" || i.status === "overdue").length} unpaid</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4" />Clients
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowAddClient(true)}>
            <Plus className="w-4 h-4 mr-2" />Add Client
          </Button>
          <Dialog open={showAddClient} onOpenChange={setShowAddClient}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Client</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="name">Company name</Label>
                  <Input id="name" value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="email">Primary email</Label>
                  <Input id="email" type="email" value={newClient.email} onChange={(e) => setNewClient({ ...newClient, email: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="billingEmail">Billing email (optional)</Label>
                  <Input id="billingEmail" type="email" value={newClient.billingEmail} onChange={(e) => setNewClient({ ...newClient, billingEmail: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Billing model</Label>
                    <Select value={newClient.billingModel} onValueChange={(v) => v && setNewClient({ ...newClient, billingModel: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="flat_monthly">Flat monthly</SelectItem>
                        <SelectItem value="per_application" disabled>Per application (coming soon)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="monthlyRate">Monthly rate (£)</Label>
                    <Input id="monthlyRate" type="number" value={newClient.monthlyRate} onChange={(e) => setNewClient({ ...newClient, monthlyRate: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="notes">Notes</Label>
                  <Input id="notes" value={newClient.notes} onChange={(e) => setNewClient({ ...newClient, notes: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAddClient(false)}>Cancel</Button>
                <Button onClick={handleAddClient} disabled={!newClient.name || !newClient.email || !newClient.monthlyRate}>Add</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {clients.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No clients yet. Add your first to start invoicing.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Billing</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.email}</TableCell>
                    <TableCell className="text-sm">{c.billingModel === "flat_monthly" ? "Monthly" : "Per app"}</TableCell>
                    <TableCell className="text-sm">{c.monthlyRate ? formatMoney(c.monthlyRate, c.currency) : "—"}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE[c.status] ?? ""}>{c.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{c._count?.invoices ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="w-4 h-4" />Invoices
          </CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No invoices yet. Add a client, then click &ldquo;Generate This Month&rdquo;.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="text-sm">{formatPeriod(inv.periodStart)}</TableCell>
                    <TableCell className="font-medium">{inv.client.name}</TableCell>
                    <TableCell>{formatMoney(inv.amount, inv.currency)}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE[inv.status] ?? ""}>{inv.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("en-GB") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {inv.status === "draft" ? (
                        <Button size="sm" variant="outline" onClick={() => handleSend(inv.id)} disabled={sendingId === inv.id}>
                          {sendingId === inv.id ? (
                            <><RefreshCw className="w-3 h-3 mr-2 animate-spin" />Sending</>
                          ) : (
                            <><Send className="w-3 h-3 mr-2" />Send</>
                          )}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {inv.sentAt ? `sent ${new Date(inv.sentAt).toLocaleDateString("en-GB")}` : ""}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
