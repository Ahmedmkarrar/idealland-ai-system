"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Home, Building2, User, Landmark, ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";

interface PortfolioOwner {
  holderName: string;
  ownerType: string;
  count: number;
  topScore: number;
  councils: string[];
  holderAddress: string | null;
  addresses: string[];
}

interface HmoProperty {
  id: string;
  council: string;
  propertyAddress: string;
  postcode: string | null;
  holderName: string | null;
  holderAddress: string | null;
  ownerType: string | null;
  portfolioSize: number;
  maxPersons: number | null;
  bedrooms: number | null;
  status: string | null;
  endDate: string | null;
  sellLikelihood: number | null;
  sellReason: string | null;
  flags: string | null;
}

function scoreBadgeClass(score: number | null): string {
  if (score == null) return "bg-gray-100 text-gray-500 border-gray-200";
  if (score >= 8) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (score >= 5) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function ownerIcon(type: string | null) {
  if (type === "company") return <Building2 className="w-3.5 h-3.5" />;
  if (type === "individual") return <User className="w-3.5 h-3.5" />;
  if (type === "institutional") return <Landmark className="w-3.5 h-3.5" />;
  return <Home className="w-3.5 h-3.5" />;
}

export default function HmoPage() {
  const [tab, setTab] = useState<"portfolios" | "properties">("portfolios");
  const [owners, setOwners] = useState<PortfolioOwner[]>([]);
  const [properties, setProperties] = useState<HmoProperty[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, p] = await Promise.all([
        fetch("/api/hmo?view=portfolios").then((r) => r.json()),
        fetch("/api/hmo?minScore=1").then((r) => r.json()),
      ]);
      setOwners(o.owners ?? []);
      setProperties(p.properties ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/hmo", { method: "POST" });
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const totalHmos = properties.length;
  const hotLeads = properties.filter((p) => (p.sellLikelihood ?? 0) >= 8).length;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Home className="w-6 h-6" /> HMO Acquisition Sourcing
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            HMO owners likely to sell — ranked from public licensing registers (free data).
          </p>
        </div>
        <Button onClick={refresh} disabled={refreshing}>
          <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing…" : "Refresh registers"}
        </Button>
      </div>

      {/* GDPR / usage notice */}
      <div className="flex gap-2 items-start rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 mb-6 text-sm text-amber-900">
        <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
        <p>
          Sourced from public HMO licensing registers, which carry a “not for marketing” notice.
          Use for opportunity identification. Favour approaching <b>companies</b> over named
          individuals, keep a suppression list, and prefer direct mail. Owner-age and
          ownership-length signals require Companies House / Land Registry (next phase).
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground uppercase">Total HMOs</p><p className="text-2xl font-bold">{totalHmos.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground uppercase">Portfolio owners (2+)</p><p className="text-2xl font-bold">{owners.length.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground uppercase">Hot leads (score 8+)</p><p className="text-2xl font-bold text-emerald-600">{hotLeads.toLocaleString()}</p></CardContent></Card>
      </div>

      <div className="flex gap-2 mb-4">
        <Button variant={tab === "portfolios" ? "default" : "outline"} size="sm" onClick={() => setTab("portfolios")}>
          Portfolio owners
        </Button>
        <Button variant={tab === "properties" ? "default" : "outline"} size="sm" onClick={() => setTab("properties")}>
          All properties
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : tab === "portfolios" ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-center">HMOs</TableHead>
                  <TableHead className="text-center">Score</TableHead>
                  <TableHead>Correspondence address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {owners.map((o) => {
                  const key = o.holderName;
                  const isOpen = expanded === key;
                  return (
                    <Fragment key={key}>
                      <TableRow className="cursor-pointer" onClick={() => setExpanded(isOpen ? null : key)}>
                        <TableCell>{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</TableCell>
                        <TableCell className="font-medium">{o.holderName}</TableCell>
                        <TableCell><span className="inline-flex items-center gap-1 text-xs text-muted-foreground">{ownerIcon(o.ownerType)}{o.ownerType}</span></TableCell>
                        <TableCell className="text-center font-bold">{o.count}</TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className={scoreBadgeClass(o.topScore)}>{o.topScore}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{o.holderAddress ?? "—"}</TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow key={`${key}-detail`}>
                          <TableCell></TableCell>
                          <TableCell colSpan={5}>
                            <p className="text-xs font-medium mb-2 text-muted-foreground">{o.count} properties{o.councils.length ? ` · ${o.councils.join(", ")}` : ""}:</p>
                            <ul className="text-xs space-y-1 columns-2">
                              {o.addresses.map((a, i) => <li key={i} className="text-foreground">• {a}</li>)}
                            </ul>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center">Score</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-center">Portfolio</TableHead>
                  <TableHead className="text-center">Max persons</TableHead>
                  <TableHead>Why</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {properties.slice(0, 300).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-center"><Badge variant="outline" className={scoreBadgeClass(p.sellLikelihood)}>{p.sellLikelihood ?? "—"}</Badge></TableCell>
                    <TableCell className="text-sm">{p.propertyAddress}</TableCell>
                    <TableCell className="text-xs"><span className="inline-flex items-center gap-1">{ownerIcon(p.ownerType)}{p.holderName ?? "—"}</span></TableCell>
                    <TableCell className="text-center">{p.portfolioSize > 1 ? <Badge variant="outline">{p.portfolioSize}</Badge> : "1"}</TableCell>
                    <TableCell className="text-center">{p.maxPersons ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-xs">{p.sellReason ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
