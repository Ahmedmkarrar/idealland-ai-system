"use client";

// Lucy's own layer on a site: correct the agent when she knows better than the
// register (the name on the application form, an email she found), and keep a
// note with a date to pick it up again — "forwarded to the owner", "combined
// with 13 Fernhill", "call in a month". Shared by Ready to Send and Sent.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CalendarClock, Pencil, StickyNote } from "lucide-react";
import { followUpDue, formatSentDate, saveLeadEdits } from "@/lib/approach-state";

export interface NotableLead {
  id: string;
  agentName: string | null;
  agentFirm: string | null;
  agentEmail: string | null;
  staffNote: string | null;
  followUpAt: string | null;
}

const dateInputValue = (value: string | null) => (value ? value.slice(0, 10) : "");

export function EditContact({ lead, onSaved }: { lead: NotableLead; onSaved: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(lead.agentName && lead.agentName !== lead.agentFirm ? lead.agentName : "");
  const [email, setEmail] = useState(lead.agentEmail ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setOpen(true)}>
        <Pencil className="w-3 h-3 mr-1" />
        Edit contact
      </Button>
    );
  }

  const save = async () => {
    setSaving(true);
    const reason = await saveLeadEdits(lead.id, { agentName: name, agentEmail: email });
    setSaving(false);
    if (reason) {
      setError(reason);
      return;
    }
    setError(null);
    setOpen(false);
    await onSaved();
  };

  return (
    <div className="rounded border bg-muted/30 p-3 space-y-2 max-w-xl">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input placeholder="Agent's full name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <p className="text-xs text-muted-foreground">
        The letter will greet them by first name. Leave the name empty for &ldquo;Good morning/afternoon&rdquo;.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save and update letter"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function LeadNote({ lead, onSaved }: { lead: NotableLead; onSaved: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(lead.staffNote ?? "");
  const [followUp, setFollowUp] = useState(dateInputValue(lead.followUpAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const due = followUpDue(lead.followUpAt);

  const save = async () => {
    setSaving(true);
    const reason = await saveLeadEdits(lead.id, { note, followUpAt: followUp || null });
    setSaving(false);
    if (reason) {
      setError(reason);
      return;
    }
    setError(null);
    setOpen(false);
    await onSaved();
  };

  if (!open) {
    return (
      <div className="space-y-1.5">
        {(lead.staffNote || lead.followUpAt) && (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm space-y-1 max-w-xl">
            {lead.staffNote && <p className="whitespace-pre-wrap text-amber-950">{lead.staffNote}</p>}
            {lead.followUpAt && (
              <p className={`text-xs flex items-center gap-1 ${due ? "text-red-700 font-semibold" : "text-amber-800"}`}>
                <CalendarClock className="w-3 h-3" />
                {due ? "Follow up due" : "Follow up"} {formatSentDate(lead.followUpAt)}
              </p>
            )}
          </div>
        )}
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setOpen(true)}>
          <StickyNote className="w-3 h-3 mr-1" />
          {lead.staffNote || lead.followUpAt ? "Edit note" : "Add note"}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded border bg-muted/30 p-3 space-y-2 max-w-xl">
      <Textarea
        rows={3}
        placeholder="e.g. Agent forwarded to the owner · combined with 13 Fernhill · call in a month"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        Follow up on
        <Input type="date" className="h-8 w-auto" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
        {followUp && (
          <button type="button" className="underline" onClick={() => setFollowUp("")}>
            clear
          </button>
        )}
      </label>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save note"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
