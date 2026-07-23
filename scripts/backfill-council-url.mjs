// One-off backfill: populate PlanningApplication.councilUrl for rows ingested
// before `url_planning_app` was added to the PLD _source allowlist (commit
// c1ae2e2). scanCouncils skips references it has already seen, so a re-scan
// will never repair these rows — they have to be patched directly.
//
// Usage: node scripts/backfill-council-url.mjs [--dry]

import Database from "better-sqlite3";

const PLD_BASE_URL = "https://planningdata.london.gov.uk";
const PLD_SEARCH_URL = `${PLD_BASE_URL}/api-guest/applications/_search`;
const BATCH_SIZE = 400;
const DRY_RUN = process.argv.includes("--dry");

// Mirrors absolutePldUrl() in lib/services/sourcing.ts: reject placeholder junk
// like "<enter PA URL here>", pass absolute URLs through, make paths absolute.
function absolutePldUrl(url) {
  const u = url?.trim();
  if (!u || u.includes("<") || u.includes(">")) return undefined;
  if (/^https?:\/\//i.test(u)) return u;
  if (!u.startsWith("/")) return undefined;
  return `${PLD_BASE_URL}${u}`;
}

async function fetchUrls(references) {
  const res = await fetch(PLD_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      size: references.length,
      _source: ["id", "url_planning_app"],
      query: { bool: { filter: [{ terms: { id: references } }] } },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`PLD ${res.status}`);
  const data = await res.json();
  const out = new Map();
  for (const hit of data.hits?.hits ?? []) {
    const src = hit._source ?? {};
    const url = absolutePldUrl(src.url_planning_app);
    if (src.id && url) out.set(src.id, url);
  }
  return out;
}

const db = new Database("prisma/dev.db");
const pending = db
  .prepare(
    `SELECT reference FROM PlanningApplication
     WHERE councilUrl IS NULL OR councilUrl = ''`
  )
  .all()
  .map((r) => r.reference);

console.log(`${pending.length} rows missing councilUrl`);

const update = db.prepare(
  `UPDATE PlanningApplication SET councilUrl = ? WHERE reference = ?`
);
const applyBatch = db.transaction((pairs) => {
  for (const [reference, url] of pairs) update.run(url, reference);
});

let matched = 0;
let updated = 0;

for (let i = 0; i < pending.length; i += BATCH_SIZE) {
  const batch = pending.slice(i, i + BATCH_SIZE);
  let urls;
  try {
    urls = await fetchUrls(batch);
  } catch (err) {
    console.error(`batch ${i}: ${err.message} — skipping`);
    continue;
  }
  matched += urls.size;
  const pairs = [...urls.entries()].map(([ref, url]) => [ref, url]);
  if (!DRY_RUN && pairs.length > 0) {
    applyBatch(pairs);
    updated += pairs.length;
  }
  console.log(
    `batch ${i}-${i + batch.length}: ${urls.size} resolved (running total ${matched})`
  );
}

const remaining = db
  .prepare(
    `SELECT COUNT(*) AS n FROM PlanningApplication
     WHERE councilUrl IS NULL OR councilUrl = ''`
  )
  .get().n;

console.log(
  `\n${DRY_RUN ? "[dry run] would update" : "updated"} ${DRY_RUN ? matched : updated} rows · ${remaining} still without a council URL`
);
db.close();
