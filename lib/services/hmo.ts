import { prisma } from "@/lib/db/client";
import { withRetry } from "@/lib/retry";

// HMO acquisition sourcing — ingest council public licensing registers (free),
// derive sell-likelihood signals, and rank owners (esp. portfolio holders) for
// James's buyers. See docs/HMO_SOURCING_SPEC.md.
//
// v1 scoring uses ONLY signals derivable from the register itself (free, no
// extra API keys): portfolio size (owner holds multiple HMOs), property size,
// licence expiry, and company-vs-individual. Owner age + ownership length come
// later via Companies House + Land Registry once those keys land.

interface HmoSource {
  key: string;        // stable source id, used in externalKey
  council: string;
  url: string;
  format: "camden";   // column mapping profile
}

// Open-data London boroughs that publish a downloadable, current CSV register.
// Camden is live + refreshed (Socrata). Barnet/Hounslow added later (older,
// different column shapes — each needs its own format profile).
const HMO_SOURCES: HmoSource[] = [
  {
    key: "camden-opendata",
    council: "Camden",
    url: "https://opendata.camden.gov.uk/api/views/x43g-c2rf/rows.csv?accessType=DOWNLOAD",
    format: "camden",
  },
];

// --- RFC-4180 CSV parser (no dependency). Handles quoted fields with embedded
// commas, escaped double-quotes (""), and embedded newlines. ---
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  // flush trailing field/row
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const UK_POSTCODE = /([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i;

function extractPostcode(address: string): string | null {
  const m = address.match(UK_POSTCODE);
  return m ? m[1].toUpperCase().replace(/\s+/, " ") : null;
}

// DD/MM/YYYY -> Date (UK register format). Returns null on anything else.
function parseUkDate(s: string | undefined): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toInt(s: string | undefined): number | null {
  if (s == null || s.trim() === "") return null;
  const n = parseInt(s.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function toFloat(s: string | undefined): number | null {
  if (s == null || s.trim() === "") return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const COMPANY_HINT = /\b(ltd|limited|llp|lp|plc|properties|property|holdings|investments|estates|lettings|group|homes|management|housing|developments?|partnership|company|co\b)\b/i;

// Institutional / purpose-built operators that will not sell individual HMOs to a
// private buyer (listed student-housing REITs, universities, foundations, NHS,
// councils, housing associations). We keep them in the data but score them down
// so genuine private-landlord targets rise to the top of James's list.
const INSTITUTIONAL_HINT = /\b(unite|urbanest|student housing|student roost|fresh student|university|universities|college|nyu|foundation|trust|nhs|council|borough|housing association|registered provider|almshouse|charity|charitable)\b/i;

function isInstitutional(name: string | null): boolean {
  return !!name && INSTITUTIONAL_HINT.test(name);
}

function classifyOwner(name: string | null): "company" | "individual" | "institutional" | "unknown" {
  if (!name || name.trim() === "") return "unknown";
  if (isInstitutional(name)) return "institutional";
  return COMPANY_HINT.test(name) ? "company" : "individual";
}

// Normalise a holder name for portfolio grouping: lowercase, strip punctuation
// and common company suffixes so "Acme Properties Ltd" == "ACME PROPERTIES LIMITED".
function normaliseHolder(name: string | null): string | null {
  if (!name) return null;
  const cleaned = name
    .toLowerCase()
    .replace(/[.,'"()&]/g, " ")
    .replace(/\b(ltd|limited|llp|plc|t\/a|ta|the|co)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 3 ? cleaned : null;
}

interface MappedRecord {
  externalKey: string;
  source: string;
  council: string;
  licenceNumber: string | null;
  licenceType: string | null;
  status: string | null;
  propertyAddress: string;
  postcode: string | null;
  holderName: string | null;
  holderAddress: string | null;
  managerName: string | null;
  managerAddress: string | null;
  maxPersons: number | null;
  storeys: number | null;
  bedrooms: number | null;
  rooms: number | null;
  commencementDate: Date | null;
  endDate: Date | null;
  latitude: number | null;
  longitude: number | null;
  ownerType: string;
}

function mapCamdenRow(get: (col: string) => string | undefined, source: HmoSource): MappedRecord | null {
  const propertyAddress = (get("Property Address") ?? "").trim();
  if (!propertyAddress) return null;

  const licenceNumber = (get("Licence Number") ?? "").trim() || null;
  const holderName = (get("Name Of Licence Holder") ?? "").trim() || null;
  const externalKey = `${source.key}:${licenceNumber ?? propertyAddress.slice(0, 80)}`;

  return {
    externalKey,
    source: source.key,
    council: source.council,
    licenceNumber,
    licenceType: (get("Type Of Licence") ?? "").trim() || null,
    status: (get("Status") ?? "").trim() || null,
    propertyAddress,
    postcode: extractPostcode(propertyAddress),
    holderName,
    holderAddress: (get("Address Of Licence Holder") ?? "").trim() || null,
    managerName: (get("Name Of Person Managing") ?? "").trim() || null,
    managerAddress: (get("Address Of Manager") ?? "").trim() || null,
    maxPersons: toInt(get("Maximum Number Of Persons")),
    storeys: toInt(get("Storeys Of HMO")),
    bedrooms: toInt(get("Number Of Bedrooms")),
    rooms: toInt(get("Number Of Rooms")),
    commencementDate: parseUkDate(get("Commencement Date")),
    endDate: parseUkDate(get("End Date")),
    latitude: toFloat(get("Latitude")),
    longitude: toFloat(get("Longitude")),
    ownerType: classifyOwner(holderName),
  };
}

// Deterministic sell-likelihood score (1-10) from register-only signals.
function scoreSell(
  rec: { maxPersons: number | null; bedrooms: number | null; endDate: Date | null; ownerType: string; status: string | null },
  portfolioSize: number
): { score: number; reason: string; flags: string[] } {
  const flags: string[] = [];
  let score = 3;

  // Institutional/student operators won't sell individual HMOs to a private
  // buyer — cap them low so they don't crowd out real targets.
  if (rec.ownerType === "institutional") {
    return { score: 1, reason: "institutional/student operator — not a private-sale target", flags: ["institutional"] };
  }

  if (portfolioSize >= 5) { score += 4; flags.push("large-portfolio"); }
  else if (portfolioSize >= 2) { score += 3; flags.push("portfolio"); }

  const big = (rec.maxPersons ?? 0) >= 6 || (rec.bedrooms ?? 0) >= 5;
  if (big) { score += 1; flags.push("large-hmo"); }

  if (rec.endDate) {
    const monthsLeft = (rec.endDate.getTime() - Date.now()) / (30 * 86400 * 1000);
    if (monthsLeft < 0) { score += 2; flags.push("licence-expired"); }
    else if (monthsLeft <= 6) { score += 1; flags.push("licence-expiring"); }
  }

  if (rec.ownerType === "company") flags.push("company-owned");
  else if (rec.ownerType === "individual") flags.push("individual-owned");

  score = Math.max(1, Math.min(10, score));

  const parts: string[] = [];
  if (portfolioSize >= 5) parts.push(`portfolio landlord (${portfolioSize} HMOs)`);
  else if (portfolioSize >= 2) parts.push(`owns ${portfolioSize} HMOs`);
  if (big) parts.push("large property");
  if (flags.includes("licence-expired")) parts.push("licence lapsed");
  else if (flags.includes("licence-expiring")) parts.push("licence expiring soon");
  if (rec.ownerType === "company") parts.push("company-owned (cleaner to approach)");
  const reason = parts.length ? parts.join("; ") : "single licensed HMO, baseline lead";

  return { score, reason, flags };
}

export async function ingestAllHmoSources(): Promise<{
  source: string; council: string; parsed: number; upserted: number;
}[]> {
  const results = [];
  for (const source of HMO_SOURCES) {
    results.push(await ingestHmoSource(source));
  }
  // Portfolio sizes + scores depend on the full table — recompute once after all
  // sources are in.
  await recomputePortfoliosAndScores();
  return results;
}

async function ingestHmoSource(source: HmoSource): Promise<{ source: string; council: string; parsed: number; upserted: number }> {
  const runRecord = await prisma.automationRun.create({ data: { type: "hmo-ingest", status: "running" } });

  try {
    const res = await withRetry(() =>
      fetch(source.url, { headers: { Accept: "text/csv" }, signal: AbortSignal.timeout(60000) })
    );
    if (!res.ok) throw new Error(`${source.key} HTTP ${res.status}`);

    const text = await res.text();
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error(`${source.key}: no data rows`);

    const header = rows[0].map((h) => h.trim());
    const idx = new Map(header.map((h, i) => [h, i] as const));
    const get = (row: string[]) => (col: string): string | undefined => {
      const i = idx.get(col);
      return i === undefined ? undefined : row[i];
    };

    const seen = new Set<string>();
    const records: MappedRecord[] = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.length < header.length / 2) continue; // skip malformed/blank
      const rec = source.format === "camden" ? mapCamdenRow(get(row), source) : null;
      if (!rec) continue;
      if (seen.has(rec.externalKey)) continue; // de-dupe within the file
      seen.add(rec.externalKey);
      records.push(rec);
    }

    let upserted = 0;
    for (const rec of records) {
      await prisma.hmoProperty.upsert({
        where: { externalKey: rec.externalKey },
        create: rec,
        update: {
          status: rec.status, holderName: rec.holderName, holderAddress: rec.holderAddress,
          managerName: rec.managerName, managerAddress: rec.managerAddress,
          maxPersons: rec.maxPersons, bedrooms: rec.bedrooms, rooms: rec.rooms, storeys: rec.storeys,
          commencementDate: rec.commencementDate, endDate: rec.endDate,
          latitude: rec.latitude, longitude: rec.longitude, ownerType: rec.ownerType,
          licenceType: rec.licenceType, postcode: rec.postcode,
        },
      });
      upserted++;
    }

    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: { status: "completed", completedAt: new Date(), summary: `${source.council}: parsed ${records.length}, upserted ${upserted} HMOs.` },
    });

    return { source: source.key, council: source.council, parsed: records.length, upserted };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: { status: "failed", completedAt: new Date(), error: message },
    });
    throw error;
  }
}

// Second pass: group the whole table by normalised holder, set portfolioSize on
// each row, then (re)score every record. Runs in JS so we control normalisation.
async function recomputePortfoliosAndScores(): Promise<void> {
  const all = await prisma.hmoProperty.findMany({
    select: { id: true, holderName: true, maxPersons: true, bedrooms: true, endDate: true, ownerType: true, status: true },
  });

  const counts = new Map<string, number>();
  for (const r of all) {
    const key = normaliseHolder(r.holderName);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  for (const r of all) {
    const key = normaliseHolder(r.holderName);
    const portfolioSize = key ? counts.get(key) ?? 1 : 1;
    const { score, reason, flags } = scoreSell(
      { maxPersons: r.maxPersons, bedrooms: r.bedrooms, endDate: r.endDate, ownerType: r.ownerType ?? "unknown", status: r.status },
      portfolioSize
    );
    await prisma.hmoProperty.update({
      where: { id: r.id },
      data: { portfolioSize, sellLikelihood: score, sellReason: reason, flags: flags.join(",") },
    });
  }
}

// Ranked property list (highest sell-likelihood first).
export async function getHmoProperties(filters?: { council?: string; minScore?: number; ownerType?: string }) {
  return prisma.hmoProperty.findMany({
    where: {
      ...(filters?.council && { council: filters.council }),
      ...(filters?.minScore && { sellLikelihood: { gte: filters.minScore } }),
      ...(filters?.ownerType && { ownerType: filters.ownerType }),
    },
    orderBy: [{ sellLikelihood: "desc" }, { portfolioSize: "desc" }],
    take: 500,
  });
}

// Portfolio owners — grouped, biggest portfolios first. The headline list for
// James's portfolio-acquisition objective.
export async function getHmoPortfolioOwners(minPortfolio = 2) {
  const all = await prisma.hmoProperty.findMany({
    select: { holderName: true, ownerType: true, council: true, propertyAddress: true, holderAddress: true, sellLikelihood: true },
  });

  const groups = new Map<string, {
    holderName: string; ownerType: string; councils: Set<string>; count: number;
    holderAddress: string | null; topScore: number; addresses: string[];
  }>();

  for (const r of all) {
    const key = normaliseHolder(r.holderName);
    if (!key || !r.holderName) continue;
    const g = groups.get(key) ?? {
      holderName: r.holderName, ownerType: r.ownerType ?? "unknown", councils: new Set<string>(),
      count: 0, holderAddress: r.holderAddress, topScore: 0, addresses: [],
    };
    g.count++;
    g.councils.add(r.council);
    g.topScore = Math.max(g.topScore, r.sellLikelihood ?? 0);
    if (g.addresses.length < 25) g.addresses.push(r.propertyAddress);
    if (!g.holderAddress && r.holderAddress) g.holderAddress = r.holderAddress;
    groups.set(key, g);
  }

  return [...groups.values()]
    .filter((g) => g.count >= minPortfolio && g.ownerType !== "institutional")
    .map((g) => ({ ...g, councils: [...g.councils] }))
    .sort((a, b) => b.count - a.count || b.topScore - a.topScore);
}
