// One-off backfill: flag sites the council (or another public body) already owns.
// Non-starters for a sourcing business — see lib/public-ownership.ts.
//
// Pulls PLD's ownership_status for every stored lead, then applies the same rules
// the ingest now uses. Prints what it flagged and why, because this hides leads
// from the working list and a false positive costs an opportunity.
//
// Usage: node scripts/backfill-public-owner.mjs [--dry]
import Database from "better-sqlite3";

const PLD = "https://planningdata.london.gov.uk/api-guest/applications/_search";
const DRY = process.argv.includes("--dry");
const BATCH = 400;

const PATTERNS = [
  /\blondon borough of\b/i, /\broyal borough of\b/i, /\bcity of london corporation\b/i,
  /\b(borough|city|district|county|parish|town)\s+council\b/i, /\bcouncil\b.*\b(of|for)\b/i,
  /^\s*councillor\b/i, /^\s*lb\s+/i,
  /\b(highways?|refuse|cleansing|street\s*scene|parks\s+and\s+open\s+spaces)\b\s*(&|and)?\s*(cleansing|services)?$/i,
  /\bplanning policy\b/i, /\bhousing (department|services|revenue account)\b/i, /\bhra\b/i,
  /\btransport for london\b|\btfl\b/i, /\bnhs\b|\bnetwork rail\b|\bministry of\b|\bdepartment for\b/i,
];
const reason = (applicant, ownership) => {
  if ((ownership ?? "").trim().toLowerCase() === "public") return "Land recorded as publicly owned";
  const n = (applicant ?? "").trim();
  if (n && PATTERNS.some((re) => re.test(n))) return `Applicant looks like a public body (${n})`;
  return null;
};

async function fetchOwnership(refs) {
  const res = await fetch(PLD, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      size: refs.length,
      _source: ["id", "application_details.ownership_status"],
      query: { bool: { filter: [{ terms: { id: refs } }] } },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`PLD ${res.status}`);
  const out = new Map();
  for (const h of (await res.json()).hits?.hits ?? []) {
    const s = h._source ?? {};
    const o = s.application_details?.ownership_status;
    if (s.id && o) out.set(s.id, String(o).trim());
  }
  return out;
}

const db = new Database("prisma/dev.db");
const rows = db.prepare(`SELECT reference, applicant FROM PlanningApplication`).all();
console.log(`${rows.length} leads to assess`);

const ownership = new Map();
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH).map((r) => r.reference);
  try { for (const [k, v] of await fetchOwnership(batch)) ownership.set(k, v); }
  catch (e) { console.error(`  batch ${i}: ${e.message} — skipping`); }
}
console.log(`  ownership_status known for ${ownership.size}`);

const upd = db.prepare(
  `UPDATE PlanningApplication SET ownershipStatus = ?, publicOwner = ?, publicOwnerReason = ? WHERE reference = ?`
);
const flagged = [];
const apply = db.transaction((list) => {
  for (const r of list) {
    const o = ownership.get(r.reference) ?? null;
    const why = reason(r.applicant, o);
    upd.run(o, why ? 1 : 0, why, r.reference);
    if (why) flagged.push([r.reference, why]);
  }
});
if (!DRY) apply(rows);
else for (const r of rows) { const why = reason(r.applicant, ownership.get(r.reference)); if (why) flagged.push([r.reference, why]); }

console.log(`\n${DRY ? "[dry run] would flag" : "flagged"} ${flagged.length} council/public-owned lead(s)`);
for (const [ref, why] of flagged.slice(0, 15)) console.log(`  ${ref.padEnd(30)} ${why}`);
if (flagged.length > 15) console.log(`  ... and ${flagged.length - 15} more`);
db.close();
