"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, Download, FileText, AlertCircle, CheckCircle, Clock } from "lucide-react";

interface Document {
  id: string;
  applicationId: string;
  type: string;
  name: string;
  url: string | null;
  fileSize: string | null;
  status: string;
  retrievedAt: string | null;
  createdAt: string;
  // Nullable on purpose — see the render below. SQLite has foreign keys off, so
  // a deleted application leaves its documents pointing at nothing.
  application: {
    reference: string;
    lpaReference: string | null;
    address: string;
    council: string;
    units: number;
  } | null;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  das: "Design & Access Statement",
  land_registry: "Land Registry",
  planning_notice: "Planning Notice",
  other: "Supporting Docs",
};

const STATUS_CONFIG = {
  retrieved: { icon: <CheckCircle className="w-3.5 h-3.5 text-green-500" />, label: "Retrieved", color: "text-green-700 bg-green-50" },
  pending: { icon: <Clock className="w-3.5 h-3.5 text-yellow-500" />, label: "Pending", color: "text-yellow-700 bg-yellow-50" },
  failed: { icon: <AlertCircle className="w-3.5 h-3.5 text-red-500" />, label: "Failed", color: "text-red-700 bg-red-50" },
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRetrieving, setIsRetrieving] = useState(false);
  // Drives the explainer above: retrieval only works with a Land Registry key, and
  // whether one is set changes what the client should expect of this page.
  const [hmlrConfigured, setHmlrConfigured] = useState(false);

  const fetchDocuments = useCallback(async () => {
    const response = await fetch("/api/documents");
    const data = await response.json();
    setDocuments(data.documents);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchDocuments();
    fetch("/api/config-status")
      .then((r) => r.json())
      .then((c) => setHmlrConfigured(!!c.hmlr))
      .catch(() => setHmlrConfigured(false));
  }, [fetchDocuments]);

  const handleRetrieveAll = async () => {
    setIsRetrieving(true);
    await fetch("/api/documents", { method: "POST" });
    await fetchDocuments();
    setIsRetrieving(false);
  };

  const retrievedCount = documents.filter((d) => d.status === "retrieved").length;
  const retrievalRate = documents.length > 0 ? (retrievedCount / documents.length) * 100 : 0;

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Site Documents</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Land Registry title documents for sites in your list
          </p>
        </div>
        <Button onClick={handleRetrieveAll} disabled={isRetrieving}>
          {isRetrieving ? (
            <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Retrieving...</>
          ) : (
            <><Download className="w-4 h-4 mr-2" />Retrieve All Pending</>
          )}
        </Button>
      </div>

      {/* This page confused the client — she saw "Document Retrieval" churning in the
          activity feed with no idea what it was or whether it needed her. Say so
          plainly, including that it is currently switched off and needs nothing. */}
      <Card className={hmlrConfigured ? "" : "border-amber-200 bg-amber-50/50"}>
        <CardContent className="pt-5 pb-5 space-y-2">
          <p className="text-sm font-semibold">What this page is</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            When the system finds a site, it can also pull that site&apos;s{" "}
            <strong>Land Registry title document</strong> — the record of who legally owns the
            land. That is useful when you want to know whether the person applying for planning
            actually owns it.
          </p>
          {hmlrConfigured ? (
            <p className="text-sm text-muted-foreground leading-relaxed">
              It is switched on and runs by itself. Nothing here needs action from you — open a
              document only if you want to check ownership on a particular site.
            </p>
          ) : (
            <>
              <p className="text-sm font-semibold pt-1">Is there anything you need to do?</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                <strong>No.</strong>{" "}This is currently switched off, because it needs a paid Land
                Registry account we agreed you don&apos;t need — the London planning feed already
                covers what you use day to day. Anything showing &ldquo;pending&rdquo; below is left
                over from before it was turned off and can be ignored. If you ever do want
                ownership records, say the word and it can be switched on.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Documents</p>
            <p className="text-3xl font-bold">{documents.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Retrieved</p>
            <p className="text-3xl font-bold text-green-600">{retrievedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Retrieval Rate</p>
            <p className="text-3xl font-bold text-blue-600">{retrievalRate.toFixed(0)}%</p>
            <Progress value={retrievalRate} className="mt-2 h-1.5" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Documents</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No documents yet. Scan for applications first, then retrieve documents.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Application</TableHead>
                  <TableHead>Council</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Retrieved</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => {
                  const statusConfig = STATUS_CONFIG[doc.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
                  return (
                    <TableRow key={doc.id}>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">{DOC_TYPE_LABELS[doc.type] ?? doc.type}</p>
                          <p className="text-xs text-muted-foreground">{doc.name}</p>
                        </div>
                      </TableCell>
                      {/* The parent site can be missing: SQLite runs with foreign keys
                          off (PRAGMA foreign_keys = 0), so Prisma's onDelete: Cascade is
                          never enforced and removing an application leaves its documents
                          behind. Reading through a null relation white-screened the whole
                          page, so render the gap instead of trusting it. */}
                      <TableCell className="font-mono text-xs">
                        {doc.application?.lpaReference ?? doc.application?.reference ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">{doc.application?.council ?? "Site no longer in the list"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{doc.fileSize ?? "—"}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${statusConfig.color}`}>
                          {statusConfig.icon}
                          {statusConfig.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {doc.retrievedAt ? new Date(doc.retrievedAt).toLocaleDateString("en-GB") : "—"}
                      </TableCell>
                      <TableCell>
                        {doc.url && (
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center p-1.5 rounded hover:bg-accent"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
