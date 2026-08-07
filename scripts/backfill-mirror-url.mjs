// One-off backfill: give every lead whose council publishes no link of its own a
// verified direct link to the PlanIndex planning register.
//
// Only applications with NO councilUrl are considered — the council's own page
// always wins. Each candidate URL is checked with a HEAD request before it is
// stored, because PlanIndex's coverage is per-application (measured ~33/40), and
// a link that 404s a fifth of the time is worse than the web search it replaces.
//
// Usage: node scripts/backfill-mirror-url.mjs [--dry] [--limit N]

import Database from "better-sqlite3";

const DRY_RUN = process.argv.includes("--dry");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
const CONCURRENCY = 6; // polite to a third-party site we don't own

function planIndexUrl(council, reference) {
  const slug = council.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const ref = reference.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug || !ref) return null;
  return `https://planindex.co.uk/planning-applications/${slug}/${ref}`;
}

async function verify(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "IdealLand-Sourcing/1.0 (+https://idealland.co.uk)" },
      signal: AbortSignal.timeout(12000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const db = new Database("prisma/dev.db");

const pending = db
  .prepare(
    `SELECT reference, council, lpaReference FROM PlanningApplication
     WHERE (councilUrl IS NULL OR councilUrl = '')
       AND (mirrorUrl IS NULL OR mirrorUrl = '')
       AND lpaReference IS NOT NULL AND lpaReference != ''`
  )
  .all()
  .slice(0, LIMIT === Infinity ? undefined : LIMIT);

console.log(`${pending.length} leads have no council link — checking the mirror for each`);

const update = db.prepare(`UPDATE PlanningApplication SET mirrorUrl = ? WHERE reference = ?`);
const applyBatch = db.transaction((pairs) => {
  for (const [reference, url] of pairs) update.run(url, reference);
});

let found = 0;
let checked = 0;

for (let i = 0; i < pending.length; i += CONCURRENCY) {
  const batch = pending.slice(i, i + CONCURRENCY);
  const results = await Promise.all(
    batch.map(async (row) => {
      const url = planIndexUrl(row.council, row.lpaReference);
      if (!url) return null;
      return (await verify(url)) ? [row.reference, url] : null;
    })
  );
  const pairs = results.filter(Boolean);
  checked += batch.length;
  found += pairs.length;
  if (!DRY_RUN && pairs.length > 0) applyBatch(pairs);
  if (checked % 60 === 0 || i + CONCURRENCY >= pending.length) {
    console.log(`  checked ${checked}/${pending.length} · ${found} direct links found`);
  }
}

console.log(
  `\n${DRY_RUN ? "[dry run] would store" : "stored"} ${found} verified direct link(s) out of ${checked} checked` +
    (checked ? ` (${Math.round((found / checked) * 100)}%)` : "")
);
db.close();
