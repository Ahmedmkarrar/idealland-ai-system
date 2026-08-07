// One-off backfill: populate PlanningApplication.lpaReference (the council's own
// reference, e.g. "26/01804/FUL") for rows ingested before `lpa_app_no` was read
// from the PLD feed. scanCouncils skips references it has already seen, so a
// re-scan will never repair these rows — they have to be patched directly.
//
// Also clears councilUrl values pointing at placeholder domains that a few
// councils left in their feed ("http://site.com/?appref=..."), so the dashboard
// falls back to a working portal/web search instead of a dead link.
//
// Usage: node scripts/backfill-lpa-reference.mjs [--dry]

import Database from "better-sqlite3";

const PLD_SEARCH_URL =
  "https://planningdata.london.gov.uk/api-guest/applications/_search";
const BATCH_SIZE = 400;
const DRY_RUN = process.argv.includes("--dry");

// Mirrors PLACEHOLDER_HOSTS in lib/planning-portals.ts.
const PLACEHOLDER_HOSTS = ["site.com", "example.com", "localhost", "test.com"];
function isPlaceholderUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PLACEHOLDER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return true; // unparseable is no use to anyone either
  }
}

async function fetchRefs(references) {
  const res = await fetch(PLD_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      size: references.length,
      _source: ["id", "lpa_app_no"],
      query: { bool: { filter: [{ terms: { id: references } }] } },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`PLD ${res.status}`);
  const data = await res.json();
  const out = new Map();
  for (const hit of data.hits?.hits ?? []) {
    const src = hit._source ?? {};
    const ref = src.lpa_app_no?.trim();
    if (src.id && ref) out.set(src.id, ref);
  }
  return out;
}

const db = new Database("prisma/dev.db");

// --- placeholder councilUrl cleanup -----------------------------------------
const suspect = db
  .prepare(`SELECT reference, councilUrl FROM PlanningApplication WHERE councilUrl IS NOT NULL AND councilUrl != ''`)
  .all()
  .filter((r) => isPlaceholderUrl(r.councilUrl));
console.log(`${suspect.length} rows carry a placeholder councilUrl`);
if (!DRY_RUN && suspect.length > 0) {
  const clear = db.prepare(`UPDATE PlanningApplication SET councilUrl = NULL WHERE reference = ?`);
  db.transaction((rows) => { for (const r of rows) clear.run(r.reference); })(suspect);
}

// --- lpaReference backfill ---------------------------------------------------
const pending = db
  .prepare(
    `SELECT reference FROM PlanningApplication
     WHERE lpaReference IS NULL OR lpaReference = ''`
  )
  .all()
  .map((r) => r.reference);

console.log(`${pending.length} rows missing lpaReference`);

const update = db.prepare(
  `UPDATE PlanningApplication SET lpaReference = ? WHERE reference = ?`
);
const applyBatch = db.transaction((pairs) => {
  for (const [reference, ref] of pairs) update.run(ref, reference);
});

let matched = 0;
let updated = 0;

for (let i = 0; i < pending.length; i += BATCH_SIZE) {
  const batch = pending.slice(i, i + BATCH_SIZE);
  let refs;
  try {
    refs = await fetchRefs(batch);
  } catch (err) {
    console.error(`batch ${i}: ${err.message} — skipping`);
    continue;
  }
  matched += refs.size;
  const pairs = [...refs.entries()];
  if (!DRY_RUN && pairs.length > 0) {
    applyBatch(pairs);
    updated += pairs.length;
  }
  console.log(
    `batch ${i}-${i + batch.length}: ${refs.size} resolved (running total ${matched})`
  );
}

const remaining = db
  .prepare(
    `SELECT COUNT(*) AS n FROM PlanningApplication
     WHERE lpaReference IS NULL OR lpaReference = ''`
  )
  .get().n;

console.log(
  `\n${DRY_RUN ? "[dry run] would update" : "updated"} ${DRY_RUN ? matched : updated} rows · ${remaining} still without a council reference`
);
db.close();
