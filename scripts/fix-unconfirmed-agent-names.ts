// Unsent letters must only greet a person the council register names as agent.
//
// Before 1 Oct 2026 the web researcher's guess went into agentName, so a letter
// could open "Dear Joshua" when the register says Matt Driscoll (Elmbridge
// 2025/3155). This re-reads Elmbridge's register, which is now supported, and on
// every other unsent lead moves a researched name into the notes so the letter
// falls back to the time-of-day greeting. Elmbridge leads the researcher gave up
// on go back in the queue. Sent letters are history and are never touched.
//
// Usage: npx tsx scripts/fix-unconfirmed-agent-names.ts [--dry]
import { prisma } from "@/lib/db/client";
import { draftApproach } from "@/lib/services/contact-finder";
import {
  extractContactFromPortal,
  PORTAL_REQUEST_DELAY_MS,
  PortalBusyError,
} from "@/lib/services/portal-extract";

const REGISTER = "Council planning register";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isElmbridge = (url: string | null) => !!url && /emaps\.elmbridge\.gov\.uk/i.test(url);

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const leads = await prisma.planningApplication.findMany({
    where: { NOT: { approachStatus: "sent" }, OR: [{ contactStatus: "found" }, { approachBody: { not: null } }] },
    select: {
      id: true, reference: true, council: true, councilUrl: true, agentName: true, agentFirm: true,
      agentPhone: true, contactNotes: true, approachBody: true,
    },
  });

  let fromRegister = 0;
  let unconfirmed = 0;
  let redrafted = 0;

  for (const lead of leads) {
    let data: { agentName?: string | null; agentFirm?: string | null; agentPhone?: string | null; contactNotes?: string | null } | null = null;

    if (isElmbridge(lead.councilUrl)) {
      try {
        const read = await extractContactFromPortal(lead.councilUrl);
        await sleep(PORTAL_REQUEST_DELAY_MS);
        if (read && (read.agentName || read.agentFirm)) {
          const moved =
            lead.agentName && lead.agentName !== read.agentName && !lead.contactNotes?.includes(REGISTER)
              ? `Web research had suggested ${lead.agentName}; the register names ${read.agentName ?? "no individual"}.`
              : null;
          data = {
            agentName: read.agentName,
            agentFirm: read.agentFirm ?? lead.agentFirm,
            agentPhone: read.agentPhone ?? lead.agentPhone,
            contactNotes: [read.source, lead.contactNotes, moved].filter(Boolean).join(" — "),
          };
          fromRegister++;
        }
      } catch (error) {
        if (!(error instanceof PortalBusyError)) throw error;
        console.warn(`${lead.reference}: register busy, skipped`);
      }
    }

    if (!data && lead.agentName && !lead.contactNotes?.includes(REGISTER)) {
      data = {
        agentName: null,
        contactNotes: [
          lead.contactNotes,
          `Web research suggests ${lead.agentName} — not named on the council register, so the letter does not address them; check the application before personalising.`,
        ]
          .filter(Boolean)
          .join(" — "),
      };
      unconfirmed++;
    }

    if (!data) continue;
    console.log(`${lead.reference}: "${lead.agentName ?? ""}" -> "${data.agentName ?? ""}"${data.agentFirm ? ` (${data.agentFirm})` : ""}`);
    if (dry) continue;
    await prisma.planningApplication.update({ where: { id: lead.id }, data });
    if (lead.approachBody) {
      const result = await draftApproach(lead.id, { force: true });
      if (result.ok) redrafted++;
      else console.warn(`${lead.reference}: ${result.reason}`);
    }
  }

  const requeue = { council: "Elmbridge", contactStatus: "not_found" };
  const requeued = dry
    ? await prisma.planningApplication.count({ where: requeue })
    : (await prisma.planningApplication.updateMany({ where: requeue, data: { contactStatus: null } })).count;

  console.log(
    `${fromRegister} read from the Elmbridge register, ${unconfirmed} unconfirmed names moved to notes, ` +
      `${redrafted} letters redrafted, ${requeued} Elmbridge not_found leads re-queued${dry ? " (dry run)" : ""}`
  );
}

main().finally(() => prisma.$disconnect());
