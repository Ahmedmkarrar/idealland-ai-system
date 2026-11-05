// One chase-up for every letter nobody answered.
//
// By 4 Nov 2026 Lucy had sent 149 letters; 8 had a recorded reply and 114 were
// over two weeks old with nothing back and no follow-up. A short second note is
// where most replies come from, so after CHASE_AFTER_DAYS each agent who hasn't
// answered gets one, drafted here, listed on the Sent page. One note per inbox,
// covering every site written to them: an agent with three letters gets one
// chase-up, not three. An agent who has come back on any site is in
// conversation with Lucy and is left to her.

import { prisma } from "@/lib/db/client";
import { groupByAgent, plainDashes, sameAgentIn, shortAddress, formatAddress } from "@/lib/approach-email";
import { chatOffer, greeting, isApproval, schemePhrase, writingToApplicant } from "@/lib/services/contact-finder";
import { councilReference } from "@/lib/planning-portals";
import { isPriorityCouncil } from "@/lib/coverage";

export const CHASE_AFTER_DAYS = Number(process.env.CHASE_AFTER_DAYS ?? 14);

export interface ChaseSite {
  id: string;
  address: string;
  council: string;
  reference: string;
  sentAt: string | null;
}

export interface ChaseUp {
  key: string;
  to: string;
  agentName: string | null;
  agentFirm: string | null;
  sites: ChaseSite[];
  subject: string;
  body: string;
}

type SentLead = Awaited<ReturnType<typeof sentLeads>>[number];

function sentLeads() {
  return prisma.planningApplication.findMany({
    where: { approachStatus: "sent" },
    select: {
      id: true, reference: true, lpaReference: true, council: true, address: true, description: true, units: true,
      status: true, decision: true, applicant: true, agentName: true, agentFirm: true, agentEmail: true,
      approachSubject: true, approachSentAt: true, approachOutcome: true, chasedAt: true,
    },
    orderBy: { approachSentAt: "desc" },
  });
}

const dayMonth = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "Europe/London" }).format(d) : null;

const STREET = /^(.*?\b(road|street|avenue|lane|close|drive|way|hill|grove|gardens|place|crescent|terrace|court|square|park|rise|walk|mews|row|green|parade|vale|end)\b)/i;

/**
 * The street, for a list of sites. Some feeds give the address without commas
 * ("8 Fernhill Oxshott Leatherhead Surrey KT22 0JH"), which shortAddress can't
 * split: cut at the street word, or keep the number and the next word.
 */
function siteName(address: string): string {
  const short = shortAddress(address);
  if (short.split(/\s+/).length <= 5) return short;
  const street = short.match(STREET)?.[1];
  if (street) return street;
  return short.match(/^\d+[a-z]?\s+\S+/i)?.[0] ?? short;
}

function sitesPhrase(leads: SentLead[]): string {
  const names = leads.map((l) => siteName(l.address));
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} other sites`;
}

function write(leads: SentLead[]): { subject: string; body: string } {
  const [latest] = leads;
  const open = greeting(latest.agentName, latest.agentFirm);
  const toOwner = leads.every((l) => l.status === "decided" && isApproval(l.decision) && writingToApplicant(l));
  const nudge = "Even a quick no is helpful, so I know not to trouble you again.";

  if (leads.length === 1) {
    const when = dayMonth(latest.approachSentAt);
    const question = toOwner
      ? "Have you had a chance to think about whether you'd sell, or are you planning to build it yourself?"
      : "Do you know yet whether your client would consider selling, or are they planning to build it themselves?";
    return {
      subject: latest.approachSubject ? `Re: ${latest.approachSubject}` : `Your scheme at ${shortAddress(latest.address)}`,
      body: plainDashes(`${open}

I wanted to follow up on my email${when ? ` of ${when}` : ""} about ${formatAddress(latest.address)} - the ${schemePhrase(latest.description, latest.units)}.

${question} ${nudge}

${chatOffer()}`),
    };
  }

  const question = toOwner
    ? "Have you had a chance to think about whether you'd sell any of them, or are you planning to build them yourself?"
    : "Do you know yet whether any of your clients would consider selling, or are they planning to build them themselves?";
  const others = leads.length - 1;
  return {
    subject: `Following up - ${siteName(latest.address)} and ${others} other site${others === 1 ? "" : "s"}`,
    body: plainDashes(`${open}

I wanted to follow up on my emails about your schemes at ${sitesPhrase(leads)}.

${question} ${nudge}

${chatOffer()}`),
  };
}

/** Every agent due a chase-up, priority boroughs and freshest letters first. */
export async function chaseUpsDue(now: Date = new Date()): Promise<ChaseUp[]> {
  const sent = await sentLeads();
  const cutoff = now.getTime() - CHASE_AFTER_DAYS * 86_400_000;
  const answered = groupByAgent(sent.filter((l) => l.approachOutcome));

  const byInbox = new Map<string, SentLead[]>();
  for (const lead of sent) {
    const to = lead.agentEmail?.trim().toLowerCase();
    if (!to || lead.approachOutcome || lead.chasedAt) continue;
    if (!lead.approachSentAt || lead.approachSentAt.getTime() > cutoff) continue;
    if (sameAgentIn(lead, answered).length > 0) continue;
    byInbox.set(to, [...(byInbox.get(to) ?? []), lead]);
  }

  const chases: ChaseUp[] = [];
  for (const [to, leads] of byInbox) {
    const { subject, body } = write(leads);
    chases.push({
      key: to,
      to,
      agentName: leads[0].agentName,
      agentFirm: leads[0].agentFirm,
      sites: leads.map((l) => ({
        id: l.id,
        address: l.address,
        council: l.council,
        reference: councilReference(l) ?? l.reference,
        sentAt: l.approachSentAt?.toISOString() ?? null,
      })),
      subject,
      body,
    });
  }
  // Her priority boroughs first, then the freshest letters: an agent written to
  // last month remembers the letter; one from August may not.
  const priority = (c: ChaseUp) => (c.sites.some((s) => isPriorityCouncil(s.council)) ? 0 : 1);
  const newest = (c: ChaseUp) => Math.max(...c.sites.map((s) => (s.sentAt ? Date.parse(s.sentAt) : 0)));
  return chases.sort((a, b) => priority(a) - priority(b) || newest(b) - newest(a));
}

/** Record (or undo) a chase-up on these sent letters. */
export async function markChased(ids: string[], chased: boolean): Promise<number> {
  const { count } = await prisma.planningApplication.updateMany({
    where: { id: { in: ids }, approachStatus: "sent" },
    data: { chasedAt: chased ? new Date() : null },
  });
  return count;
}
