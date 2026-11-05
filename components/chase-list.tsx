"use client";

// The Sent page's "Chase-ups due": one ready-to-send note per agent who hasn't
// answered in two weeks (lib/services/chase.ts).

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Copy, Mail, MapPin, Undo2 } from "lucide-react";
import { approachMailto, refreshGreeting } from "@/lib/approach-email";
import { formatSentDate } from "@/lib/approach-state";

export interface ChaseUp {
  key: string;
  to: string;
  agentName: string | null;
  agentFirm: string | null;
  sites: Array<{ id: string; address: string; council: string; reference: string; sentAt: string | null }>;
  subject: string;
  body: string;
}

async function setChased(ids: string[], chased: boolean): Promise<boolean> {
  const res = await fetch("/api/sourcing/chases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, chased }),
  });
  return res.ok;
}

export function ChaseList({ chases, onChanged }: { chases: ChaseUp[]; onChanged: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  // Marked in this session, so a slip can be undone before the list refreshes away.
  const [done, setDone] = useState<Map<string, string[]>>(new Map());

  const copy = async (chase: ChaseUp) => {
    await navigator.clipboard.writeText(`${chase.subject}\n\n${refreshGreeting(chase.body)}`);
    setCopied(chase.key);
    setTimeout(() => setCopied(null), 2000);
  };

  const mark = async (chase: ChaseUp, chased: boolean) => {
    setSaving(chase.key);
    const ids = chase.sites.map((s) => s.id);
    if (await setChased(ids, chased)) {
      setDone((prev) => {
        const next = new Map(prev);
        if (chased) next.set(chase.key, ids);
        else next.delete(chase.key);
        return next;
      });
      onChanged();
    }
    setSaving(null);
  };

  if (chases.length === 0 && done.size === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No chase-ups due. Agents who haven&rsquo;t replied two weeks after a letter appear here.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground max-w-3xl">
        These agents haven&rsquo;t come back in two weeks. Each gets one short follow-up, covering every site you wrote to them
        about. Copy it (or open it in your email), send it, then press <strong>Mark as chased</strong>. If they reply, tick{" "}
        <strong>Came back to us</strong> on the site as usual.
      </p>
      {[...done.keys()].map((key) => (
        <Card key={`done-${key}`} className="max-w-4xl border-emerald-200 bg-emerald-50/50">
          <CardContent className="py-3 flex items-center justify-between gap-3 text-sm">
            <span>
              <Check className="w-4 h-4 inline mr-1.5 text-emerald-600" />
              Chased <strong>{key}</strong>
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={saving === key}
              onClick={async () => {
                setSaving(key);
                if (await setChased(done.get(key) ?? [], false)) {
                  setDone((prev) => {
                    const next = new Map(prev);
                    next.delete(key);
                    return next;
                  });
                  onChanged();
                }
                setSaving(null);
              }}
            >
              <Undo2 className="w-3 h-3 mr-1" />
              Undo
            </Button>
          </CardContent>
        </Card>
      ))}
      {chases
        .filter((c) => !done.has(c.key))
        .map((chase) => {
          const who = [chase.agentName, chase.agentFirm].filter(Boolean).join(" · ") || chase.to;
          return (
            <Card key={chase.key} className="max-w-4xl">
              <CardContent className="pt-4 pb-4 space-y-3">
                <div>
                  <p className="font-medium text-sm">{who}</p>
                  <p className="text-xs text-muted-foreground">{chase.to}</p>
                </div>
                <ul className="space-y-1">
                  {chase.sites.map((site) => (
                    <li key={site.id} className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>
                        {site.address} · {site.council} · <span className="font-mono">{site.reference}</span> · sent{" "}
                        {formatSentDate(site.sentAt)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2">
                  <p className="font-medium">{chase.subject}</p>
                  <p className="whitespace-pre-line">{refreshGreeting(chase.body)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={approachMailto(chase.to, chase.subject, chase.body)}>
                    <Button size="sm" variant="outline">
                      <Mail className="w-3.5 h-3.5 mr-1.5" />
                      Open in email
                    </Button>
                  </a>
                  <Button size="sm" variant="outline" onClick={() => copy(chase)}>
                    {copied === chase.key ? (
                      <><Check className="w-3.5 h-3.5 mr-1.5" />Copied</>
                    ) : (
                      <><Copy className="w-3.5 h-3.5 mr-1.5" />Copy</>
                    )}
                  </Button>
                  <Button size="sm" disabled={saving === chase.key} onClick={() => mark(chase, true)}>
                    <Check className="w-3.5 h-3.5 mr-1.5" />
                    Mark as chased
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
    </div>
  );
}
