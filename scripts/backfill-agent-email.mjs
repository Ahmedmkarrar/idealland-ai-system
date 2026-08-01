// One-off backfill: clear agentEmail values that aren't real addresses.
//
// The contact-finder's web search sometimes returns an email *pattern* rather
// than a confirmed address — e.g. "firstname@weareupp.co.uk (common format;
// verify specific contact person)". Those rows rendered as one-click-sendable in
// the dashboard, so a send would bounce. findAgentContact() now rejects them at
// write time (lib/email-address.ts); this patches rows written before that.
//
// The rejected value is preserved in contactNotes so the research isn't lost —
// the lead simply moves to the "need an email address" queue.
//
// Usage: node scripts/backfill-agent-email.mjs [--dry]

import Database from "better-sqlite3";

const DRY_RUN = process.argv.includes("--dry");

// Kept in sync with lib/email-address.ts (that module is TypeScript, so the
// patterns are duplicated here rather than imported into a plain-node script).
const SINGLE_ADDRESS = /^[^\s@<>()[\],;:]+@[^\s@<>()[\],;:]+\.[a-z]{2,}$/i;
const TEMPLATE_LOCAL_PART =
  /^(firstname|first[._-]?name|first[._-]?last|lastname|last[._-]?name|surname|initial|yourname|name|email|user)$/i;

function usableEmail(raw) {
  if (!raw) return { email: null, rejected: null };
  const candidate = raw.trim().replace(/^mailto:/i, "").replace(/^<|>$/g, "");
  if (!SINGLE_ADDRESS.test(candidate)) return { email: null, rejected: candidate };
  if (TEMPLATE_LOCAL_PART.test(candidate.split("@")[0])) return { email: null, rejected: candidate };
  return { email: candidate, rejected: null };
}

const dbPath = process.env.SQLITE_PATH ?? "prisma/dev.db";
const db = new Database(dbPath);

const rows = db
  .prepare(
    `SELECT id, reference, council, agentEmail, contactNotes
     FROM PlanningApplication
     WHERE agentEmail IS NOT NULL AND agentEmail != ''`
  )
  .all();

const bad = rows
  .map((row) => ({ row, ...usableEmail(row.agentEmail) }))
  .filter((entry) => entry.rejected !== null);

console.log(`Scanned ${rows.length} row(s) with an agentEmail; ${bad.length} unusable.`);

const update = db.prepare(
  `UPDATE PlanningApplication SET agentEmail = NULL, contactNotes = ? WHERE id = ?`
);

for (const { row, rejected } of bad) {
  const note = [
    row.contactNotes,
    `Unverified email pattern returned ("${rejected}") — not a confirmed address. Identify the individual before sending.`,
  ]
    .filter(Boolean)
    .join(" ");

  console.log(`  ${row.council} ${row.reference}: ${rejected}`);
  if (!DRY_RUN) update.run(note, row.id);
}

console.log(DRY_RUN ? "Dry run — nothing written." : `Cleared ${bad.length} unusable address(es).`);
db.close();
