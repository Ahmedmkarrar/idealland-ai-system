// Rewrites every unsent approach draft with the current letter builder, so a
// wording change reaches the letters already waiting on the Ready page. Sent
// letters are history and are never touched. `--dry` prints the count only.
//
// Usage: npx tsx scripts/redraft-unsent.ts [--dry]
import { prisma } from "@/lib/db/client";
import { draftApproach } from "@/lib/services/contact-finder";

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const drafts = await prisma.planningApplication.findMany({
    where: { approachStatus: "drafted", approachBody: { not: null } },
    select: { id: true },
  });
  console.log(`${drafts.length} unsent drafts${dry ? " (dry run)" : ""}`);
  if (dry) return;
  let done = 0;
  for (const { id } of drafts) {
    const result = await draftApproach(id, { force: true });
    if (result.ok) done++;
    else console.warn(`${id}: ${result.reason}`);
  }
  console.log(`${done} redrafted`);
}

main().finally(() => prisma.$disconnect());
