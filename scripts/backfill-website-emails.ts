// Letters waiting in "Need an address": look for the practice's inbox on its
// own website and, when found, move the letter to "Ready to email". The letter
// text is unchanged — only the address is added. `--dry` prints without writing.
//
// Usage: npx tsx scripts/backfill-website-emails.ts [--dry]
import { prisma } from "@/lib/db/client";
import { inCoverage } from "@/lib/coverage";
import { emailFromPracticeWebsite } from "@/lib/services/contact-finder";

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const leads = await prisma.planningApplication.findMany({
    where: {
      ...inCoverage,
      contactStatus: "found",
      approachStatus: "drafted",
      publicOwner: false,
      OR: [{ agentEmail: null }, { agentEmail: "" }],
    },
    select: { id: true, reference: true, agentName: true, agentFirm: true, agentWebsite: true, contactNotes: true },
  });

  let found = 0;
  for (const lead of leads) {
    // Only a practice name: a person's name would match strangers' websites.
    const firm = lead.agentFirm;
    const hit = await emailFromPracticeWebsite(lead.agentWebsite, firm, lead.agentName);
    console.log(`${hit ? "FOUND" : "none "}\t${lead.reference}\t${firm ?? ""}\t${hit?.email ?? ""}`);
    if (!hit) continue;
    found++;
    if (dry) continue;
    await prisma.planningApplication.update({
      where: { id: lead.id },
      data: {
        agentEmail: hit.email,
        agentWebsite: lead.agentWebsite ?? hit.website,
        contactNotes: [lead.contactNotes, hit.note].filter(Boolean).join(" — "),
      },
    });
  }
  console.log(`${found} of ${leads.length} letters now have an address${dry ? " (dry run)" : ""}`);
}

main().finally(() => prisma.$disconnect());
