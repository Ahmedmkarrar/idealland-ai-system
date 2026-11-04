// Lucy (4 Nov 2026): letters on Ready to Send were "missing the agent's name".
// For every unsent letter whose contact has a firm but no person, re-read the
// Wandsworth register (it names more people than the first parser kept) or read
// the name from the agent's mailbox (lib/agent-name.ts), then rewrite the letter
// so it opens "Dear <first name>". `--dry` lists what would change.
//
// Usage: npx tsx scripts/backfill-agent-names.ts [--dry]
import { prisma } from "@/lib/db/client";
import { inCoverage } from "@/lib/coverage";
import { NAME_FROM_MAILBOX, nameFromMailbox } from "@/lib/agent-name";
import { agileIdFromUrl } from "@/lib/services/agile-api";
import { extractContactFromPortal } from "@/lib/services/portal-extract";
import { draftApproach } from "@/lib/services/contact-finder";

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const leads = await prisma.planningApplication.findMany({
    where: {
      ...inCoverage,
      contactStatus: "found",
      OR: [{ agentName: null }, { agentName: "" }],
      AND: [{ OR: [{ approachStatus: null }, { approachStatus: { in: ["drafted", "pending"] } }] }],
    },
    select: { id: true, lpaReference: true, council: true, councilUrl: true, agentFirm: true, agentEmail: true, contactNotes: true },
  });
  console.log(`${leads.length} unsent leads with a firm but no named agent`);

  let named = 0;
  for (const lead of leads) {
    let name: string | null = null;
    let firm = lead.agentFirm;
    let notes = lead.contactNotes;
    if (lead.councilUrl && agileIdFromUrl(lead.councilUrl) !== null) {
      const fresh = await extractContactFromPortal(lead.councilUrl).catch(() => null);
      if (fresh?.agentName) {
        name = fresh.agentName;
        // The register's own read wins, firm included — the old parse stored some
        // people ("Shloime Godlewsky") as the firm, which blocks the greeting.
        firm = fresh.agentFirm;
        notes = fresh.source;
      }
    }
    if (!name) {
      name = nameFromMailbox(lead.agentEmail, lead.agentFirm, (lead.contactNotes ?? "").includes("Council planning register"));
      if (name && !(notes ?? "").includes(NAME_FROM_MAILBOX)) notes = [notes, NAME_FROM_MAILBOX].filter(Boolean).join(" — ");
    }
    if (!name) continue;
    named++;
    console.log(`  ${lead.council} ${lead.lpaReference}: ${name}${firm ? ` (${firm})` : ""}`);
    if (dry) continue;
    await prisma.planningApplication.update({ where: { id: lead.id }, data: { agentName: name, agentFirm: firm, contactNotes: notes } });
    await draftApproach(lead.id, { force: true });
  }
  console.log(`${named} named${dry ? " (dry run)" : ", letters rewritten"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
