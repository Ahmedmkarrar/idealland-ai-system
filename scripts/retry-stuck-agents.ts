// Second read of leads stuck on "agent not found yet" (4 Nov 2026). Registers
// fill in after the first read, and Idox application forms name the agent where
// the contacts tab doesn't; the daily run now retries these weekly, and this runs
// the backlog once. Drafts a letter when an agent with an email turns up.
// `--dry` reads the registers without saving.
//
// Must run on the droplet (Wandsworth answers UK addresses only).
// Usage: npx tsx scripts/retry-stuck-agents.ts [--dry]
import { prisma } from "@/lib/db/client";
import { inCoverage, MIN_SCORE_PRIORITY } from "@/lib/coverage";
import { extractContactFromPortal, isSupportedPortal } from "@/lib/services/portal-extract";
import { draftApproach, findAgentContact } from "@/lib/services/contact-finder";

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const leads = await prisma.planningApplication.findMany({
    where: {
      ...inCoverage,
      contactStatus: "not_found",
      publicOwner: false,
      leadScore: { gte: MIN_SCORE_PRIORITY },
      councilUrl: { not: null },
      AND: [
        { OR: [{ approachStatus: null }, { approachStatus: { notIn: ["sent", "discarded", "pending"] } }] },
        { OR: [{ status: { not: "decided" } }, { decision: { contains: "Approv" } }, { decision: { contains: "Grant" } }] },
      ],
    },
    select: { id: true, council: true, lpaReference: true, councilUrl: true },
  });
  const readable = leads.filter((l) => isSupportedPortal(l.councilUrl) && !/wandsworth\.gov\.uk\/Northgate/i.test(l.councilUrl ?? ""));
  console.log(`${leads.length} stuck leads, ${readable.length} on registers we can read`);

  let found = 0;
  let drafted = 0;
  for (const lead of readable) {
    if (dry) {
      const c = await extractContactFromPortal(lead.councilUrl).catch((e: Error) => `ERR ${e.message}`);
      console.log(`  ${lead.council} ${lead.lpaReference}: ${JSON.stringify(c)}`);
      continue;
    }
    const r = await findAgentContact(lead.id, { force: true });
    const who = r.result ? [r.result.agentName, r.result.agentFirm, r.result.agentEmail].filter(Boolean).join(" / ") : r.reason;
    console.log(`  ${lead.council} ${lead.lpaReference}: ${r.result?.found ? "FOUND " : ""}${who ?? ""}`);
    if (r.ok && r.result?.found) {
      found++;
      if (r.result.agentEmail && (await draftApproach(lead.id)).ok) drafted++;
    }
  }
  if (!dry) console.log(`${found} agents found, ${drafted} letters drafted`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
