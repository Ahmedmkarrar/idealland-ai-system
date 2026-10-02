// Unsent Surrey letters whose practice came from PlanIt at ingest were shown as
// "found by web search". PlanIt relays the council's own agent fields, so where
// PlanIt still names the same practice, the contact notes are marked as register
// data. `--dry` prints without writing.
//
// Usage: npx tsx scripts/backfill-planit-source.ts [--dry]
import { prisma } from "@/lib/db/client";

const SOURCE = "Council planning register (via PlanIt)";
const AUTHORITY: Record<string, string> = {
  Elmbridge: "Elmbridge", "Mole Valley": "MoleValley", "Reigate & Banstead": "Reigate",
  Guildford: "Guildford", "Epsom & Ewell": "Epsom",
};
const comparable = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const leads = await prisma.planningApplication.findMany({
    where: {
      reference: { startsWith: "PlanIt-" },
      agentFirm: { not: null },
      NOT: [{ approachStatus: "sent" }, { contactNotes: { contains: "Council planning register" } }],
    },
    select: { id: true, reference: true, council: true, lpaReference: true, agentFirm: true, contactNotes: true },
  });
  let marked = 0;
  for (const lead of leads) {
    const authority = AUTHORITY[lead.council];
    if (!authority || !lead.lpaReference) continue;
    const res = await fetch(`https://www.planit.org.uk/planapplic/${authority}/${lead.lpaReference}/geojson`);
    await sleep(1000);
    if (!res.ok) continue;
    const fields = (await res.json())?.properties?.other_fields ?? {};
    const planitFirm: string | undefined = fields.agent_company ?? fields.agent_address?.split(",")[0];
    const match = comparable(planitFirm) && comparable(planitFirm) === comparable(lead.agentFirm);
    console.log(`${match ? "MATCH" : "differs"}\t${lead.reference}\tours: ${lead.agentFirm}\tPlanIt: ${planitFirm ?? ""}`);
    if (!match || dry) continue;
    await prisma.planningApplication.update({
      where: { id: lead.id },
      data: { contactNotes: [SOURCE, lead.contactNotes].filter(Boolean).join(" — ") },
    });
    marked++;
  }
  console.log(`${marked} marked as register data${dry ? " (dry run)" : ""}`);
}

main().finally(() => prisma.$disconnect());
