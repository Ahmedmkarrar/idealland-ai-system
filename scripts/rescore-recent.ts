// Re-score recent leads under the 4 Nov 2026 rubric. The old one capped every
// 1-2 home scheme at 4-6 and marked sites down for "mid-tier" postcodes, so most
// schemes in Merton, Lambeth, Hammersmith & Fulham and Wandsworth never reached
// the bar for research or a letter (Lucy, 4 Nov: James worried "the ratings might
// be too severe").
//
// Only leads not yet written to are touched: a sent letter's score is history.
// `--since=YYYY-MM-DD` sets the window (default 1 Sep 2026). `--dry` counts only.
//
// Usage: npx tsx scripts/rescore-recent.ts [--since=2026-09-01] [--dry]
import { prisma } from "@/lib/db/client";
import { inCoverage, isPriorityCouncil } from "@/lib/coverage";
import { analyzeApplication } from "@/lib/services/intelligence";

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const sinceArg = process.argv.find((a) => a.startsWith("--since="))?.split("=")[1] ?? "2026-09-01";
  const since = new Date(`${sinceArg}T00:00:00Z`);

  const leads = await prisma.planningApplication.findMany({
    where: {
      ...inCoverage,
      createdAt: { gte: since },
      publicOwner: false,
      // A plain NOT IN drops every lead with no letter status (SQL NULL).
      OR: [{ approachStatus: null }, { approachStatus: { notIn: ["sent", "discarded", "pending"] } }],
    },
    select: { id: true, council: true, leadScore: true },
    orderBy: { submittedAt: "desc" },
  });
  console.log(`${leads.length} leads since ${sinceArg} not yet written to`);
  if (dry) return;

  const moves = new Map<string, { before: number; after: number; up: number; down: number; n: number }>();
  for (const [i, lead] of leads.entries()) {
    const r = await analyzeApplication(lead.id, { force: true });
    if (!r.ok || !r.result) continue;
    const m = moves.get(lead.council) ?? { before: 0, after: 0, up: 0, down: 0, n: 0 };
    m.n++;
    m.before += lead.leadScore ?? 0;
    m.after += r.result.score;
    if (r.result.score > (lead.leadScore ?? 0)) m.up++;
    if (r.result.score < (lead.leadScore ?? 0)) m.down++;
    moves.set(lead.council, m);
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${leads.length}`);
  }

  for (const [council, m] of [...moves].sort((a, b) => b[1].n - a[1].n)) {
    const tag = isPriorityCouncil(council) ? " (priority)" : "";
    console.log(
      `${council}${tag}: ${m.n} leads, avg ${(m.before / m.n).toFixed(1)} -> ${(m.after / m.n).toFixed(1)}, ${m.up} up, ${m.down} down`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
