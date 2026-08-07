// Spotting sites the council (or another public body) already owns.
//
// Lucy's words, 2026-08-07: "If they are owned by the council — of which there
// will be a few — they are non starters." She can't broker a sale of land the
// borough owns, so these are pure noise in a list she is already drowning in.
//
// Two signals, because neither is sufficient alone:
//   1. PLD's `ownership_status` — authoritative when it says "Public", but the
//      field is only populated on about 39% of applications.
//   2. The applicant's name. Councils file under their own name, a department
//      ("Highways & Cleansing", "Refuse and Cleansing"), or a named councillor.
//
// Deliberately conservative: this hides leads from her default view, so a false
// positive costs her an opportunity. Housing associations are NOT matched — they
// do sometimes sell, and she only asked about councils.

const PUBLIC_APPLICANT_PATTERNS: RegExp[] = [
  /\blondon borough of\b/i,
  /\broyal borough of\b/i,
  /\bcity of london corporation\b/i,
  /\b(borough|city|district|county|parish|town)\s+council\b/i,
  /\bcouncil\b.*\b(of|for)\b/i,
  /^\s*councillor\b/i,
  /^\s*lb\s+/i,
  /\b(highways?|refuse|cleansing|street\s*scene|parks\s+and\s+open\s+spaces)\b\s*(&|and)?\s*(cleansing|services)?$/i,
  /\bplanning policy\b/i,
  /\bhousing (department|services|revenue account)\b/i,
  /\bhra\b/i,
  /\btransport for london\b|\btfl\b/i,
  /\bnhs\b|\bnetwork rail\b|\bministry of\b|\bdepartment for\b/i,
];

/** True when the applicant name looks like a council or other public body. */
export function looksPublicApplicant(applicant: string | null | undefined): boolean {
  const name = applicant?.trim();
  if (!name) return false;
  return PUBLIC_APPLICANT_PATTERNS.some((re) => re.test(name));
}

/** True when PLD explicitly records the land as publicly owned. */
export function isPublicOwnership(ownershipStatus: string | null | undefined): boolean {
  return (ownershipStatus ?? "").trim().toLowerCase() === "public";
}

/**
 * Whether this looks like a council-owned site. Returns the reason too, so the
 * dashboard can say why a lead was set aside rather than silently dropping it.
 */
export function publicOwnerReason(app: {
  applicant?: string | null;
  ownershipStatus?: string | null;
}): string | null {
  if (isPublicOwnership(app.ownershipStatus)) return "Land recorded as publicly owned";
  if (looksPublicApplicant(app.applicant)) return `Applicant looks like a public body (${app.applicant})`;
  return null;
}
