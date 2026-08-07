// One-off backfill: record what the council actually decided on leads already
// stored as status="decided". Without it every decided lead is treated as a
// permission granted, and roughly a quarter of them are refusals — see
// isApproval() in lib/services/contact-finder.ts.
//
// Usage: node scripts/backfill-decision.mjs [--dry]
import Database from "better-sqlite3";

const PLD = "https://planningdata.london.gov.uk/api-guest/applications/_search";
const DRY = process.argv.includes("--dry");
const BATCH = 400;

async function fetchDecisions(refs) {
  const res = await fetch(PLD, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      size: refs.length,
      _source: ["id", "decision"],
      query: { bool: { filter: [{ terms: { id: refs } }] } },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`PLD ${res.status}`);
  const data = await res.json();
  const out = new Map();
  for (const h of data.hits?.hits ?? []) {
    const s = h._source ?? {};
    if (s.id && s.decision) out.set(s.id, String(s.decision).trim());
  }
  return out;
}

const db = new Database("prisma/dev.db");
const pending = db
  .prepare(`SELECT reference FROM PlanningApplication WHERE status='decided' AND (decision IS NULL OR decision='')`)
  .all()
  .map((r) => r.reference);

console.log(`${pending.length} decided leads with no recorded decision`);
const upd = db.prepare(`UPDATE PlanningApplication SET decision = ? WHERE reference = ?`);
const apply = db.transaction((pairs) => { for (const [ref, d] of pairs) upd.run(d, ref); });

let updated = 0;
const tally = {};
for (let i = 0; i < pending.length; i += BATCH) {
  const batch = pending.slice(i, i + BATCH);
  let map;
  try { map = await fetchDecisions(batch); }
  catch (e) { console.error(`batch ${i}: ${e.message} — skipping`); continue; }
  const pairs = [...map.entries()];
  for (const [, d] of pairs) tally[d] = (tally[d] ?? 0) + 1;
  if (!DRY && pairs.length) apply(pairs);
  updated += pairs.length;
  console.log(`  batch ${i}-${i + batch.length}: ${pairs.length} resolved (total ${updated})`);
}
console.log(`\n${DRY ? "[dry run] would update" : "updated"} ${updated} rows`);
for (const [k, v] of Object.entries(tally).sort((a,b)=>b[1]-a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
db.close();
