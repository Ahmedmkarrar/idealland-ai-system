// London unit counts came straight from the DataHub, which often disagrees with
// the application ("6 units" for "3no residential flats"), and the letter quotes
// the number to the agent. This re-reads the count from each description and
// corrects it only when two signals agree: the reader's count, and a number the
// description itself puts next to a word for homes. Anything else is reported,
// not changed — the reader alone has misread descriptions. Unsent letters whose
// number changes are rewritten; sent letters are history. `--dry` prints.
//
// Usage: npx tsx scripts/recount-london-units.ts [--dry]
import { prisma } from "@/lib/db/client";
import { inCoverage } from "@/lib/coverage";
import { readNewHomes } from "@/lib/services/planit";
import { draftApproach } from "@/lib/services/contact-finder";

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const STATED =
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine)\s*(?:x\s*)?(?:no\.?s?\s*)?(?:[\w-]+\s+){0,3}?(?:dwellings?|flats?|houses?|homes|units|apartments?|maisonettes?|bungalows?)\b/gi;

/** Every number the description puts in front of a word for homes. */
function statedCounts(description: string): number[] {
  return [...description.matchAll(STATED)].map((m) => WORD_NUMBERS[m[1].toLowerCase()] ?? Number(m[1]));
}

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const leads = await prisma.planningApplication.findMany({
    where: { ...inCoverage, NOT: [{ reference: { startsWith: "PlanIt-" } }] },
    select: { id: true, reference: true, units: true, description: true, approachStatus: true, approachBody: true },
  });
  const open = leads.filter((l) => l.approachStatus !== "sent");

  let changed = 0;
  let redrafted = 0;
  for (let i = 0; i < open.length; i += 40) {
    const batch = open.slice(i, i + 40);
    const counts = await readNewHomes(batch.map((l) => l.description));
    for (const [j, lead] of batch.entries()) {
      const count = counts[j];
      if (count === null || count === lead.units) continue;
      const inBand = count >= 1 && count <= 9;
      const confirmed = inBand && statedCounts(lead.description).includes(count);
      const label = confirmed ? "fix" : inBand ? "unconfirmed" : "OUT OF BAND";
      console.log(`${label}\t${lead.reference}\t${lead.units} -> ${count}${lead.approachBody ? "\t(letter)" : ""}`);
      if (dry || !confirmed) continue;
      await prisma.planningApplication.update({ where: { id: lead.id }, data: { units: count } });
      changed++;
      if (lead.approachBody) {
        const result = await draftApproach(lead.id, { force: true });
        if (result.ok) redrafted++;
      }
    }
  }
  console.log(`${open.length} London leads read, ${changed} counts corrected, ${redrafted} letters rewritten${dry ? " (dry run)" : ""}`);
}

main().finally(() => prisma.$disconnect());
