// A site that won planning permission in the last few weeks is the strongest
// letter Lucy sends: the agent has the news fresh and few buyers have called
// yet. Shared by Ready to Send (which puts these first) and the morning digest.

export const FRESH_PERMISSION_DAYS = 21;

export function isApprovalDecision(decision: string | null | undefined): boolean {
  if (!decision) return false;
  if (/refus|reject|withdraw|lapsed|declined|closed|not required/i.test(decision)) return false;
  return /approv|grant|permit|consent|allowed/i.test(decision);
}

/** Days since the council approved it, when that was within the fresh window. */
export function freshPermissionAge(
  lead: { status: string; decision: string | null; decidedAt: Date | string | null },
  now: Date = new Date()
): number | null {
  if (lead.status !== "decided" || !isApprovalDecision(lead.decision) || !lead.decidedAt) return null;
  const days = Math.floor((now.getTime() - new Date(lead.decidedAt).getTime()) / 86_400_000);
  return days >= 0 && days <= FRESH_PERMISSION_DAYS ? days : null;
}

export function freshLabel(days: number): string {
  if (days === 0) return "approved today";
  if (days === 1) return "approved yesterday";
  return `approved ${days} days ago`;
}
