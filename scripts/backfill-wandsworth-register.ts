// Wandsworth moved its register from Northgate to Agile Applications in Sep 2026.
// Every Wandsworth lead stored before then links to a Northgate page that now
// 404s, so agent research on those leads has failed ever since (16 leads scored
// 7+ were stuck on "no agent found" on 4 Nov). This finds each lead on the new
// register by its council reference, repoints the link, and re-runs agent
// research on the stuck ones that are worth a letter — drafting a letter when an
// agent turns up.
//
// Must run on the droplet: the register answers only UK addresses.
//
// Usage: npx tsx scripts/backfill-wandsworth-register.ts [--dry] [--no-research]
import { prisma } from "@/lib/db/client";
import { MIN_SCORE_PRIORITY } from "@/lib/coverage";
import { findWandsworthByReference, wandsworthApplicationUrl } from "@/lib/services/agile-api";
import { draftApproach, findAgentContact } from "@/lib/services/contact-finder";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const research = !process.argv.includes("--no-research");

  const leads = await prisma.planningApplication.findMany({
    where: {
      council: "Wandsworth",
      lpaReference: { not: null },
      OR: [{ councilUrl: null }, { councilUrl: { contains: "Northgate" } }],
    },
    select: { id: true, lpaReference: true, contactStatus: true, leadScore: true, publicOwner: true, status: true, decision: true },
  });
  console.log(`${leads.length} Wandsworth leads with an old or missing register link`);

  let repointed = 0;
  let missing = 0;
  const retry: string[] = [];
  for (const lead of leads) {
    const found = await findWandsworthByReference(lead.lpaReference!).catch((e: Error) => {
      console.warn(`  ${lead.lpaReference}: ${e.message}`);
      return null;
    });
    await sleep(500);
    if (!found) {
      missing++;
      continue;
    }
    repointed++;
    if (!dry) {
      await prisma.planningApplication.update({ where: { id: lead.id }, data: { councilUrl: wandsworthApplicationUrl(found.id) } });
    }
    const live = lead.status !== "decided" || /approv|grant/i.test(lead.decision ?? "");
    if (lead.contactStatus === "not_found" && !lead.publicOwner && live && (lead.leadScore ?? 0) >= MIN_SCORE_PRIORITY) {
      retry.push(lead.id);
    }
  }
  console.log(`${repointed} repointed, ${missing} not on the new register, ${retry.length} stuck leads to research again`);
  if (dry || !research) return;

  let contacts = 0;
  let drafted = 0;
  for (const id of retry) {
    const r = await findAgentContact(id, { force: true });
    if (r.ok && r.result?.found) {
      contacts++;
      if ((await draftApproach(id)).ok) drafted++;
    }
  }
  console.log(`${contacts} agents found, ${drafted} letters drafted`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
