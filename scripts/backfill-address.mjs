// One-off backfill: repair the ~31% of leads stored with a placeholder address
// ("Croydon (ref 26/00603/CONR)") instead of a real one.
//
// Cause: buildAddress() only read PLD's structured location fields (site_number /
// street_name / postcode). Boroughs are split on how they populate location —
// the rest put the whole address in `site_name` as one carriage-return-separated
// string ("51 Streatham Hill\rLondon\rLambeth\rSW2 4TS"), which we never read.
// Fixed at ingest, but scanCouncils skips references it has already seen, so
// existing rows need patching directly.
//
// Usage: node scripts/backfill-address.mjs [--dry]

import Database from "better-sqlite3";

const PLD_SEARCH_URL =
  "https://planningdata.london.gov.uk/api-guest/applications/_search";
const BATCH_SIZE = 400;
const DRY_RUN = process.argv.includes("--dry");

// Mirrors decodeEntities() in lib/services/sourcing.ts.
const HTML_ENTITIES = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
  "&quot;": '"', "&apos;": "'", "&#39;": "'", "&#38;": "&",
};
function decodeEntities(value) {
  return value
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&apos;|&#39;|&#38;/g, (m) => HTML_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

// Mirrors buildAddress() in lib/services/sourcing.ts, minus the placeholder
// fallback — this returns null rather than re-writing the placeholder we're
// trying to replace.
function buildAddress(s) {
  const parts = [s.site_number, s.street_name, s.secondary_street_name, s.postcode]
    .map((p) => (p === null || p === undefined ? "" : decodeEntities(String(p))))
    .filter((p) => p.length > 0);
  if (parts.length > 0) return parts.join(", ");

  if (s.site_name) {
    const lines = String(s.site_name)
      .split(/[\r\n]+/)
      .map((line) => decodeEntities(line).replace(/,$/, "").trim())
      .filter((line) => line.length > 0);
    if (lines.length > 0) return lines.join(", ");
  }
  return null;
}

async function fetchAddresses(references) {
  const res = await fetch(PLD_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      size: references.length,
      _source: [
        "id", "site_name", "site_number", "street_name",
        "secondary_street_name", "postcode",
      ],
      query: { bool: { filter: [{ terms: { id: references } }] } },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`PLD ${res.status}`);
  const data = await res.json();
  const out = new Map();
  for (const hit of data.hits?.hits ?? []) {
    const src = hit._source ?? {};
    const address = buildAddress(src);
    if (src.id && address) out.set(src.id, address);
  }
  return out;
}

const db = new Database("prisma/dev.db");

// Only rows still showing the "<Council> (ref <x>)" placeholder.
const pending = db
  .prepare(`SELECT reference FROM PlanningApplication WHERE address LIKE '%(ref %'`)
  .all()
  .map((r) => r.reference);

console.log(`${pending.length} rows have a placeholder address`);

const update = db.prepare(`UPDATE PlanningApplication SET address = ? WHERE reference = ?`);
const applyBatch = db.transaction((pairs) => {
  for (const [reference, address] of pairs) update.run(address, reference);
});

let updated = 0;
const samples = [];

for (let i = 0; i < pending.length; i += BATCH_SIZE) {
  const batch = pending.slice(i, i + BATCH_SIZE);
  let addresses;
  try {
    addresses = await fetchAddresses(batch);
  } catch (err) {
    console.error(`batch ${i}: ${err.message} — skipping`);
    continue;
  }
  const pairs = [...addresses.entries()];
  if (samples.length < 5) samples.push(...pairs.slice(0, 5 - samples.length));
  if (!DRY_RUN && pairs.length > 0) applyBatch(pairs);
  updated += pairs.length;
  console.log(`batch ${i}-${i + batch.length}: ${pairs.length} resolved (running total ${updated})`);
}

if (samples.length > 0) {
  console.log(`\nsample of what it writes:`);
  for (const [ref, addr] of samples) console.log(`  ${ref.padEnd(28)} -> ${addr}`);
}

const remaining = db
  .prepare(`SELECT COUNT(*) AS n FROM PlanningApplication WHERE address LIKE '%(ref %'`)
  .get().n;

console.log(
  `\n${DRY_RUN ? "[dry run] would update" : "updated"} ${updated} rows · ${remaining} still on a placeholder address`
);
db.close();
