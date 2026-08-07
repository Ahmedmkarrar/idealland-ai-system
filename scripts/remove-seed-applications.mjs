// Removes the demo planning applications created by POST /api/seed on
// 2026-05-15, which are still sitting in the live pipeline alongside real leads.
//
// They are identifiable and unambiguous:
//   - reference looks like "GRE/2026/5946/45" (a made-up LPA/year/nnnn/nn shape),
//     where every real row's reference is a GLA document id ("Croydon-26_01804_FUL")
//   - addresses are invented ("126 Church Road, Greenwich, London")
//   - unit counts sit outside the 1-9 band the system actually targets
//   - none has a councilUrl or an lpaReference, because no such application exists
//
// Dry by default. Pass --delete to actually remove them.
//
// Usage: node scripts/remove-seed-applications.mjs [--delete]

import Database from "better-sqlite3";

const DELETE = process.argv.includes("--delete");
const db = new Database("prisma/dev.db");

// GLOB, not LIKE: this must not match a real reference by accident.
const SEED_PATTERN = "[A-Z][A-Z][A-Z]/[0-9][0-9][0-9][0-9]/[0-9]*/[0-9]*";

const rows = db
  .prepare(
    `SELECT id, reference, council, address, units, leadScore, lpaReference, councilUrl
     FROM PlanningApplication
     WHERE reference GLOB ?`
  )
  .all(SEED_PATTERN);

// Belt and braces: refuse to touch anything that looks like it came from the
// real feed, however it matched the pattern.
const suspicious = rows.filter((r) => r.lpaReference || r.councilUrl);
if (suspicious.length > 0) {
  console.error(
    `Refusing to run — ${suspicious.length} matching row(s) carry real feed data:`
  );
  for (const r of suspicious) console.error(`  ${r.reference} (${r.council})`);
  process.exit(1);
}

console.log(`${rows.length} seed application(s) matched:\n`);
for (const r of rows.slice(0, 10)) {
  console.log(`  ${r.reference.padEnd(20)} ${r.council.padEnd(14)} ${String(r.units).padStart(3)} units  score ${r.leadScore ?? "-"}  ${r.address}`);
}
if (rows.length > 10) console.log(`  ... and ${rows.length - 10} more`);

// Documents / status history / social posts cascade on delete; outreach drafts
// attached to these fake rows go with them, which is the intent.
if (!DELETE) {
  console.log(`\n[dry run] pass --delete to remove these ${rows.length} rows`);
  db.close();
  process.exit(0);
}

// Delete children explicitly. Prisma declares onDelete: Cascade, but this database
// runs with `PRAGMA foreign_keys = 0`, so SQLite never enforces it — dropping the
// parent alone would leave orphaned documents behind, and the Documents page reads
// straight through that relation.
const statements = [
  db.prepare(`DELETE FROM Document WHERE applicationId = ?`),
  db.prepare(`DELETE FROM ApplicationStatusChange WHERE applicationId = ?`),
  db.prepare(`DELETE FROM OutreachEmail WHERE applicationId = ?`),
  db.prepare(`UPDATE SocialPost SET applicationId = NULL WHERE applicationId = ?`), // onDelete: SetNull
  db.prepare(`DELETE FROM PlanningApplication WHERE id = ?`),
];
const run = db.transaction((list) => {
  for (const r of list) for (const stmt of statements) stmt.run(r.id);
});
run(rows);

const orphans = db
  .prepare(
    `SELECT COUNT(*) AS n FROM Document d
     LEFT JOIN PlanningApplication p ON p.id = d.applicationId
     WHERE p.id IS NULL`
  )
  .get().n;
if (orphans > 0) console.error(`⚠️  ${orphans} orphaned document(s) remain — investigate before deploying`);

const remaining = db.prepare(`SELECT COUNT(*) AS n FROM PlanningApplication`).get().n;
console.log(`\ndeleted ${rows.length} seed rows · ${remaining} real applications remain`);
db.close();
