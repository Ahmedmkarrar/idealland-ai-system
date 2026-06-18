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

// Fetch + compute the Companies House signals for a holder name (one set of API
// calls). Returned data is holder-level, so callers can apply it to every
// property that shares the holder without re-querying. null = no match found.
async function fetchCompanyData(holderName: string): Promise<EnrichmentResult | null> {
  const company = await resolveCompany(holderName);
  if (!company) return null;

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

  const incRaw = profile?.date_of_creation;
  const incorporationDate = incRaw ? new Date(incRaw) : null;

  return {
    companyNumber: company.company_number,
    companyStatus: profile?.company_status ?? company.company_status ?? null,
    incorporationDate: incorporationDate && !Number.isNaN(incorporationDate.getTime()) ? incorporationDate : null,
    maxDirectorAge: aged.length ? aged[0].age : null,
    directorSummary: aged.length ? aged.map((d) => `${d.name ?? "director"} (${d.age})`).join(", ") : null,
  };
}

// Apply holder-level CH data to a single property row: store the fields, fold
// the signals into flags, and nudge the deterministic sellLikelihood. Per-row
// because flags/score build on each row's existing values.
async function applyEnrichmentToRow(
  row: { id: string; flags: string | null; sellLikelihood: number | null },
  data: EnrichmentResult
): Promise<void> {
  const flagSet = new Set((row.flags ?? "").split(",").map((f) => f.trim()).filter(Boolean));
  let scoreBump = 0;
  if (data.maxDirectorAge != null && data.maxDirectorAge >= 70) { flagSet.add("director-retirement-age"); scoreBump += 2; }
  else if (data.maxDirectorAge != null && data.maxDirectorAge >= 60) { flagSet.add("director-nearing-retirement"); scoreBump += 1; }
  if (data.incorporationDate && new Date().getFullYear() - data.incorporationDate.getFullYear() >= 20) {
    flagSet.add("long-established"); scoreBump += 1;
  }
  if (data.companyStatus && data.companyStatus !== "active") { flagSet.add(`company-${data.companyStatus}`); scoreBump += 1; }

  const newScore =
    scoreBump > 0 && row.sellLikelihood != null ? Math.min(10, row.sellLikelihood + scoreBump) : row.sellLikelihood ?? undefined;

  await prisma.hmoProperty.update({
    where: { id: row.id },
    data: {
      companyNumber: data.companyNumber,
      companyStatus: data.companyStatus,
      incorporationDate: data.incorporationDate,
      maxDirectorAge: data.maxDirectorAge,
      directorSummary: data.directorSummary,
      flags: [...flagSet].join(","),
      ...(newScore !== undefined && { sellLikelihood: newScore }),
      enrichedAt: new Date(),
    },
  });
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

  const data = await fetchCompanyData(p.holderName);
  if (!data) {
    // Record the attempt so we don't keep re-querying a holder with no match.
    await prisma.hmoProperty.update({ where: { id: propertyId }, data: { enrichedAt: new Date() } });
    return { ok: false, reason: "No matching company found on Companies House" };
  }

  await applyEnrichmentToRow(p, data);
  return { ok: true, result: data };
}

// Bulk-enrich the top `limit` DISTINCT company owners that haven't been
// enriched yet, biggest portfolios first. Each company is looked up on
// Companies House once, then the result is applied to all of that owner's
// properties — so the limit is in distinct owners, not rows, and we don't burn
// the API re-querying the same landlord. Re-run to continue the backlog.
export async function bulkEnrichHmo(limit = 40): Promise<{
  enriched: number; ownersProcessed: number; unmatched: number; reason?: string;
}> {
  if (!isCompaniesHouseConfigured()) {
    return { enriched: 0, ownersProcessed: 0, unmatched: 0, reason: "COMPANIES_HOUSE_API_KEY not configured" };
  }

  const pending = await prisma.hmoProperty.findMany({
    where: { ownerType: "company", enrichedAt: null, holderName: { not: null } },
    select: { id: true, holderName: true, flags: true, sellLikelihood: true },
    orderBy: [{ portfolioSize: "desc" }, { sellLikelihood: "desc" }],
  });

  // Group remaining rows by exact holder name, ordered by first appearance
  // (which is already biggest-portfolio-first from the query above).
  const byHolder = new Map<string, typeof pending>();
  for (const row of pending) {
    const key = row.holderName!;
    const arr = byHolder.get(key) ?? [];
    arr.push(row);
    byHolder.set(key, arr);
  }

  let enriched = 0;
  let ownersProcessed = 0;
  let unmatched = 0;

  for (const [holderName, rows] of byHolder) {
    if (ownersProcessed >= limit) break;
    ownersProcessed++;

    const data = await fetchCompanyData(holderName);
    if (!data) {
      // Mark every row of this holder as attempted so we don't retry it.
      await prisma.hmoProperty.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { enrichedAt: new Date() },
      });
      unmatched++;
      continue;
    }

    for (const row of rows) {
      await applyEnrichmentToRow(row, data);
      enriched++;
    }
  }

  return { enriched, ownersProcessed, unmatched };
}
