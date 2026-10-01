// For every unsent letter whose contact came from web search, read the council
// register (where we can) and print what it names instead. With --apply the
// register's contact replaces the researched one and the letter is redrafted:
// on 1 Oct 2026 this found four letters addressed to the wrong firm entirely
// (Sutton DM2026/00830 to Praedium; the register says MJA Architecture).
//
// Usage: npx tsx scripts/audit-web-contacts.ts [--apply]
import { prisma } from "@/lib/db/client";
import { draftApproach } from "@/lib/services/contact-finder";
import { extractContactFromPortal, isSupportedPortal, PORTAL_REQUEST_DELAY_MS } from "@/lib/services/portal-extract";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const comparable = (v: string | null) =>
  (v ?? "").toLowerCase().replace(/\b(ltd|limited|llp)\b/g, "").replace(/[^a-z0-9]/g, "");

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  let applied = 0;
  const leads = await prisma.planningApplication.findMany({
    where: { approachStatus: "drafted", NOT: { contactNotes: { contains: "Council planning register" } } },
    select: {
      id: true, reference: true, councilUrl: true, agentName: true, agentFirm: true, agentEmail: true,
      agentPhone: true, contactNotes: true,
    },
  });
  for (const lead of leads) {
    if (!isSupportedPortal(lead.councilUrl)) {
      console.log(`NOREG\t${lead.reference}\t${lead.agentFirm ?? ""}\t${lead.agentEmail ?? ""}`);
      continue;
    }
    try {
      const read = await extractContactFromPortal(lead.councilUrl);
      console.log(
        `REG\t${lead.reference}\tours: ${lead.agentName ?? ""} / ${lead.agentFirm ?? ""} / ${lead.agentEmail ?? ""}` +
          `\tregister: ${read ? `${read.agentName ?? ""} / ${read.agentFirm ?? ""} / ${read.agentEmail ?? ""}` : "nothing"}`
      );
      if (apply && read && (read.agentName || read.agentFirm || read.agentEmail)) {
        // The researched email only survives when the register names the same practice.
        const sameFirm = !!read.agentFirm && comparable(read.agentFirm) === comparable(lead.agentFirm);
        await prisma.planningApplication.update({
          where: { id: lead.id },
          data: {
            agentName: read.agentName,
            agentFirm: read.agentFirm ?? (read.agentName ? null : lead.agentFirm),
            agentEmail: read.agentEmail ?? (sameFirm ? lead.agentEmail : null),
            agentPhone: read.agentPhone ?? (sameFirm ? lead.agentPhone : null),
            contactNotes: `${read.source} — replaced web research (${[lead.agentFirm, lead.agentEmail].filter(Boolean).join(", ") || "no details"}) on 1 Oct 2026.`,
            contactStatus: "found",
          },
        });
        await draftApproach(lead.id, { force: true });
        applied++;
      }
    } catch (error) {
      console.log(`BUSY\t${lead.reference}\t${(error as Error).message}`);
    }
    await sleep(PORTAL_REQUEST_DELAY_MS * 2);
  }
  if (apply) console.log(`${applied} contacts replaced from the register and redrafted`);
}

main().finally(() => prisma.$disconnect());
