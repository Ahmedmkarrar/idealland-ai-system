// Where a site stands with Lucy — shared by the Sourcing, Ready to Send and Sent
// pages so a tick on one page reads the same everywhere.

export type ApproachChange = {
  status?: "sent" | "not_sent";
  outcome?: ApproachOutcomeValue | null;
};

export type ApproachOutcomeValue = "replied" | "interested" | "won" | "dead";

/**
 * Stored values stay short for the ROI maths; the labels are Lucy's words.
 * "Came back to us" is the one she asked for — the others narrow it down.
 */
export const OUTCOME_OPTIONS: ReadonlyArray<{ value: ApproachOutcomeValue; label: string; className: string }> = [
  { value: "replied", label: "Came back to us", className: "bg-violet-100 text-violet-800 border-violet-300" },
  { value: "interested", label: "Interested in selling", className: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  { value: "won", label: "Deal agreed", className: "bg-amber-100 text-amber-900 border-amber-300" },
  { value: "dead", label: "Not interested", className: "bg-slate-100 text-slate-700 border-slate-300" },
];

export function outcomeLabel(value: string | null): string | null {
  return OUTCOME_OPTIONS.find((o) => o.value === value)?.label ?? null;
}

/** Anyone who answered, whatever they said. */
export function cameBack(outcome: string | null): boolean {
  return outcome !== null && outcome !== undefined;
}

export async function updateApproach(applicationId: string, changes: ApproachChange): Promise<boolean> {
  const res = await fetch("/api/sourcing/approach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId, ...changes }),
  });
  return res.ok;
}

export type LeadEdits = {
  agentName?: string | null;
  agentEmail?: string | null;
  note?: string | null;
  followUpAt?: string | null;
};

/** Returns null on success, or the reason the server refused. */
export async function saveLeadEdits(applicationId: string, edits: LeadEdits): Promise<string | null> {
  const res = await fetch("/api/sourcing/approach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId, edits }),
  });
  if (res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.reason ?? data.error ?? "Couldn't save";
}

/** A follow-up date that is today or already past. */
export function followUpDue(value: string | null): boolean {
  if (!value) return false;
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return new Date(value) <= end;
}

export type ContactSource = "register" | "lucy" | "web";

/**
 * Where the contact on a letter came from. Only the register and Lucy are
 * authoritative; web research has put the wrong firm on letters (1 Oct 2026),
 * so those are flagged for her to check against the application first.
 */
export function contactSource(notes: string | null): ContactSource {
  if (notes?.startsWith(ENTERED_BY_LUCY)) return "lucy";
  if (notes?.includes("Council planning register")) return "register";
  return "web";
}

export const ENTERED_BY_LUCY = "Entered by Lucy";

export function formatSentDate(value: string | null): string {
  if (!value) return "date not recorded";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
