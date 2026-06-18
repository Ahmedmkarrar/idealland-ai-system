// Companies House enrichment for HMO sourcing (Phase 2 of docs/HMO_SOURCING_SPEC.md).
//
// For company-owned HMOs we resolve the licence holder to a Companies House
// company, then pull the signals a human acquisitions analyst cares about:
//   - director ages  → an elderly director (60+) is a strong retirement/exit signal
//   - incorporation date → long-established operators are more likely to wind down
//   - company status → flag dissolved/liquidation (distress / changed ownership)
//
// Free API (https://developer.company-information.service.gov.uk), HTTP Basic
// auth with the API key as the username and a blank password. Rate limit is
// 600 requests / 5 min — bulkEnrich paces itself well under that. No-ops
// gracefully when COMPANIES_HOUSE_API_KEY is absent, like the other services.
import { prisma } from "@/lib/db/client";
import { withRetry } from "@/lib/retry";

const CH_BASE = "https://api.company-information.service.gov.uk";

export function isCompaniesHouseConfigured(): boolean {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  return !!(key && !key.includes("PLACEHOLDER"));
}

function authHeader(): string {
  const key = process.env.COMPANIES_HOUSE_API_KEY ?? "";
  // Basic auth: "<key>:" base64-encoded (password is blank).
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

async function chGet<T>(path: string): Promise<T | null> {
  if (!isCompaniesHouseConfigured()) return null;
  try {
    const res = await withRetry(() =>
      fetch(`${CH_BASE}${path}`, {
        headers: { Authorization: authHeader(), Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      })
    );
    // 404 = no such company/officer list; treat as "no data", not an error.
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Companies House ${res.status} on ${path}`);
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// --- Name matching ------------------------------------------------------
// Normalise a company name for comparison: lowercase, drop punctuation and
// common suffixes, collapse whitespace. Mirrors normaliseHolder in hmo.ts so a
// register holder name lines up with a Companies House title.
function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,'"()&]/g, " ")
    .replace(/\b(ltd|limited|llp|plc|t\/a|ta|the|co|company)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface CompanySearchItem {
  company_number: string;
  title: string;
  company_status?: string;
}

// Resolve a holder name to the best Companies House company: prefer an active
// company whose normalised title exactly matches; else the first active match;
// else the first match at all. Returns null if nothing plausible.
async function resolveCompany(holderName: string): Promise<CompanySearchItem | null> {
  const q = encodeURIComponent(holderName);
  const data = await chGet<{ items?: CompanySearchItem[] }>(
    `/search/companies?q=${q}&items_per_page=10`
  );
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  const target = normalise(holderName);
  const exactActive = items.find((i) => normalise(i.title) === target && i.company_status === "active");
  if (exactActive) return exactActive;

  const exact = items.find((i) => normalise(i.title) === target);
  if (exact) return exact;

  const firstActive = items.find((i) => i.company_status === "active");
  return firstActive ?? items[0];
}

interface Officer {
  name?: string;
  officer_role?: string;
  resigned_on?: string;
  date_of_birth?: { month?: number; year?: number };
}

interface EnrichmentResult {
  companyNumber: string;
  companyStatus: string | null;
  incorporationDate: Date | null;
  maxDirectorAge: number | null;
  directorSummary: string | null;
}

// "SURNAME, Forename" -> "Forename Surname" for a friendlier display string.
function tidyOfficerName(name: string): string {
  const parts = name.split(",");
  if (parts.length === 2) return `${parts[1].trim()} ${parts[0].trim()}`;
  return name.trim();
}

function ageFromDob(dob: { year?: number } | undefined): number | null {
  if (!dob?.year) return null;
  const age = new Date().getFullYear() - dob.year;
  return age > 0 && age < 120 ? age : null;
}

export async function enrichHmoProperty(
  propertyId: string,
  options?: { force?: boolean }
): Promise<{ ok: boolean; reason?: string; result?: EnrichmentResult }> {
  const p = await prisma.hmoProperty.findUnique({ where: { id: propertyId } });
  if (!p) return { ok: false, reason: "HMO not found" };
  if (p.ownerType !== "company") {
    return { ok: false, reason: "Not company-owned — Companies House enrichment only applies to companies" };
  }
  if (!p.holderName) return { ok: false, reason: "No holder name to look up" };
  if (!options?.force && p.enrichedAt) {
    return { ok: true, reason: "Already enriched (pass force=true to re-run)" };
  }
  if (!isCompaniesHouseConfigured()) {
    return { ok: false, reason: "COMPANIES_HOUSE_API_KEY not configured" };
  }

  const company = await resolveCompany(p.holderName);
  if (!company) {
    // Record the attempt so we don't keep re-querying a holder with no match.
    await prisma.hmoProperty.update({ where: { id: propertyId }, data: { enrichedAt: new Date() } });
    return { ok: false, reason: "No matching company found on Companies House" };
  }

  const [profile, officersData] = await Promise.all([
    chGet<{ company_status?: string; date_of_creation?: string }>(`/company/${company.company_number}`),
    chGet<{ items?: Officer[] }>(`/company/${company.company_number}/officers`),
  ]);

  const activeDirectors = (officersData?.items ?? []).filter(
    (o) => !o.resigned_on && (o.officer_role ?? "").includes("director")
  );

  const aged = activeDirectors
    .map((o) => ({ name: o.name ? tidyOfficerName(o.name) : null, age: ageFromDob(o.date_of_birth) }))
    .filter((d): d is { name: string | null; age: number } => d.age !== null)
    .sort((a, b) => b.age - a.age);

  const maxDirectorAge = aged.length ? aged[0].age : null;
  const directorSummary = aged.length
    ? aged.map((d) => `${d.name ?? "director"} (${d.age})`).join(", ")
    : null;

  const incRaw = profile?.date_of_creation;
  const incorporationDate = incRaw ? new Date(incRaw) : null;
  const companyStatus = profile?.company_status ?? company.company_status ?? null;

  // Fold the new signals into the deterministic flags + score so they surface
  // even before an AI pass. Retirement-age director and long-established
  // company both push sell-likelihood up.
  const flagSet = new Set((p.flags ?? "").split(",").map((f) => f.trim()).filter(Boolean));
  let scoreBump = 0;
  if (maxDirectorAge != null && maxDirectorAge >= 70) { flagSet.add("director-retirement-age"); scoreBump += 2; }
  else if (maxDirectorAge != null && maxDirectorAge >= 60) { flagSet.add("director-nearing-retirement"); scoreBump += 1; }
  if (incorporationDate && new Date().getFullYear() - incorporationDate.getFullYear() >= 20) {
    flagSet.add("long-established"); scoreBump += 1;
  }
  if (companyStatus && companyStatus !== "active") { flagSet.add(`company-${companyStatus}`); scoreBump += 1; }

  const newScore =
    scoreBump > 0 && p.sellLikelihood != null
      ? Math.min(10, p.sellLikelihood + scoreBump)
      : p.sellLikelihood ?? undefined;

  await prisma.hmoProperty.update({
    where: { id: propertyId },
    data: {
      companyNumber: company.company_number,
      companyStatus,
      incorporationDate: incorporationDate && !Number.isNaN(incorporationDate.getTime()) ? incorporationDate : null,
      maxDirectorAge,
      directorSummary,
      flags: [...flagSet].join(","),
      ...(newScore !== undefined && { sellLikelihood: newScore }),
      enrichedAt: new Date(),
    },
  });

  return {
    ok: true,
    result: { companyNumber: company.company_number, companyStatus, incorporationDate, maxDirectorAge, directorSummary },
  };
}

// Bulk-enrich company-owned HMOs that haven't been enriched yet, biggest
// portfolios first. Caps the batch to stay well within the rate limit and to
// bound a single run; re-run to continue through the backlog.
export async function bulkEnrichHmo(limit = 40): Promise<{ enriched: number; skipped: number; reason?: string }> {
  if (!isCompaniesHouseConfigured()) {
    return { enriched: 0, skipped: 0, reason: "COMPANIES_HOUSE_API_KEY not configured" };
  }

  const pending = await prisma.hmoProperty.findMany({
    where: { ownerType: "company", enrichedAt: null, holderName: { not: null } },
    orderBy: [{ portfolioSize: "desc" }, { sellLikelihood: "desc" }],
    take: limit,
  });

  let enriched = 0;
  let skipped = 0;
  for (const p of pending) {
    const r = await enrichHmoProperty(p.id);
    if (r.ok) enriched++;
    else skipped++;
  }

  return { enriched, skipped };
}
