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

export function formatSentDate(value: string | null): string {
  if (!value) return "date not recorded";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
