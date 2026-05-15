"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, RefreshCw, Trash2 } from "lucide-react";

interface ErrorRun {
  id: string;
  type: string;
  status: string;
  error: string | null;
  summary: string | null;
  startedAt: string;
  completedAt: string | null;
}

const RUN_TYPE_LABELS: Record<string, string> = {
  sourcing: "Sourcing Scan",
  documents: "Document Retrieval",
  social: "Social Content",
  ads: "Ad Campaigns",
  mailing: "Mailing",
  decisions: "Decision Check",
};

const TYPE_COLORS: Record<string, string> = {
  sourcing: "bg-blue-100 text-blue-800",
  documents: "bg-purple-100 text-purple-800",
  social: "bg-orange-100 text-orange-800",
  ads: "bg-green-100 text-green-800",
  mailing: "bg-rose-100 text-rose-800",
  decisions: "bg-yellow-100 text-yellow-800",
};

export default function ErrorsPage() {
  const [errorRuns, setErrorRuns] = useState<ErrorRun[] | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const fetchErrors = useCallback(async () => {
    const response = await fetch("/api/errors");
    const data = (await response.json()) as { errors: ErrorRun[] };
    setErrorRuns(data.errors);
  }, []);

  useEffect(() => {
    fetchErrors();
  }, [fetchErrors]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchErrors();
    setIsRefreshing(false);
  };

  const handleClear = async () => {
    setIsClearing(true);
    await fetch("/api/errors", { method: "DELETE" });
    await fetchErrors();
    setIsClearing(false);
  };

  if (!errorRuns) {
    return (
      <div className="p-8 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Error Log</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {errorRuns.length === 0
              ? "No failed automation runs"
              : `${errorRuns.length} failed run${errorRuns.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex gap-2">
          {errorRuns.length > 0 && (
            <Button
              onClick={handleClear}
              disabled={isClearing}
              variant="outline"
              size="sm"
              className="text-red-600 hover:text-red-700"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {isClearing ? "Clearing..." : "Clear all"}
            </Button>
          )}
          <Button onClick={handleRefresh} disabled={isRefreshing} variant="outline" size="sm">
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {errorRuns.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <AlertCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h3 className="font-semibold text-lg">No errors</h3>
            <p className="text-muted-foreground text-sm mt-1">
              All automation runs have completed successfully.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {errorRuns.map((run) => {
            const duration =
              run.completedAt
                ? Math.round(
                    (new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000
                  )
                : null;

            return (
              <Card key={run.id} className="border-red-200">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <CardTitle className="text-base">
                        {RUN_TYPE_LABELS[run.type] ?? run.type}
                      </CardTitle>
                      <Badge
                        className={`text-xs font-medium ${TYPE_COLORS[run.type] ?? "bg-gray-100 text-gray-800"}`}
                        variant="outline"
                      >
                        {run.type}
                      </Badge>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted-foreground">
                        {new Date(run.startedAt).toLocaleString()}
                      </p>
                      {duration !== null && (
                        <p className="text-xs text-muted-foreground">{duration}s</p>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {run.error && (
                    <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2">
                      <p className="text-xs font-mono text-red-700 break-all">{run.error}</p>
                    </div>
                  )}
                  {run.summary && (
                    <p className="text-sm text-muted-foreground">{run.summary}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
