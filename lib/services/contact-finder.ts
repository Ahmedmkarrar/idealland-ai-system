// Contact discovery — the labour-intensive heart of IdealLand's real workflow.
//
// When the AI surfaces a suitable planning application, IdealLand must reach the
// person who FILED it (usually the agent — architect / planning consultant —
// sometimes the owner) to ask whether the owner will sell the site. That contact
// is almost never in the GLA planning feed; it lives on the council's own portal
// page and, for email/phone, on the firm's website or LinkedIn. Finding it by
// hand is what makes the job slow.
//
// findAgentContact() does that legwork with Claude + web search:
//   1. reads the council application page + searches the web for the agent/firm
//   2. returns agent name, firm, email, phone, website
// draftApproach() then writes the seller-approach email to that agent.
//
// Honest limit: contact emails aren't in any public dataset and LinkedIn can't be
// scraped, so this collapses ~an hour of manual research to a reviewed dossier —
// not a guaranteed auto-contact. The UI hands staff LinkedIn/Google/council links
// to finish the last mile.
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/client";
import { withRetry } from "@/lib/retry";
import { usableEmail } from "@/lib/email-address";
import { ENTERED_BY_LUCY } from "@/lib/approach-state";
import { findEmailOnWebsite, guessWebsites } from "@/lib/services/website-email";
import { councilReference } from "@/lib/planning-portals";
import { agentKeys, formatAddress, groupByAgent, sameAgentIn, plainDashes, shortAddress, timeGreeting } from "@/lib/approach-email";
import {
  extractContactFromPortal,
  resolveIdoxApplicationUrl,
  PortalBusyError,
  type PortalContact,
} from "@/lib/services/portal-extract";
import { buyingArea, inCoverage } from "@/lib/coverage";

const MODEL = "claude-haiku-4-5-20251001";

function isClaudeConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!(key && !key.includes("PLACEHOLDER"));
}

interface ContactResult {
  agentName: string | null;
  agentFirm: string | null;
  agentEmail: string | null;
  agentPhone: string | null;
  agentWebsite: string | null;
  notes: string | null;
  found: boolean;
}

// Pull the final assistant text out of a (possibly multi-round) web-search
// response, resuming the server-tool loop if it pauses. Web search runs
// server-side, so we only read the text it produces at the end.
async function runWithWebSearch(client: Anthropic, prompt: string): Promise<string | null> {
  const tools = [{ type: "web_search_20250305" as const, name: "web_search" as const, max_uses: 5 }];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

  for (let round = 0; round < 4; round++) {
    const res = await withRetry(() =>
      client.messages.create({ model: MODEL, max_tokens: 1024, tools, messages })
    );

    if (res.stop_reason === "pause_turn") {
      // Server hit its per-turn tool cap — resend to let it continue.
      messages.push({ role: "assistant", content: res.content });
      continue;
    }

    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }
  return null;
}

function parseJson<T>(raw: string): T | null {
  const cleaned = raw
    .replace(/^[\s\S]*?```(?:json)?\s*/i, (m) => (m.includes("```") ? "" : m))
    .replace(/```[\s\S]*$/i, "")
    .trim();
  // Fall back to the first {...} block if the model wrapped it in prose.
  const candidate = cleaned.startsWith("{") ? cleaned : cleaned.match(/\{[\s\S]*\}/)?.[0] ?? "";
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}

type ContactDetails = Pick<ContactResult, "agentName" | "agentFirm" | "agentEmail" | "agentPhone">;

/** The register's read, filled out with whatever the lead already carried. */
function withKnownDetails(fromPortal: PortalContact | null, app: ContactDetails): ContactDetails {
  return {
    agentName: fromPortal?.agentName ?? app.agentName,
    agentFirm: fromPortal?.agentFirm ?? app.agentFirm,
    agentEmail: fromPortal?.agentEmail ?? usableEmail(app.agentEmail).email,
    agentPhone: fromPortal?.agentPhone ?? app.agentPhone,
  };
}

async function saveContact(applicationId: string, result: ContactResult): Promise<void> {
  await prisma.planningApplication.update({
    where: { id: applicationId },
    data: {
      agentName: result.agentName,
      agentFirm: result.agentFirm,
      agentEmail: result.agentEmail,
      agentPhone: result.agentPhone,
      agentWebsite: result.agentWebsite,
      contactNotes: result.notes,
      contactStatus: result.found ? "found" : "not_found",
      contactResearchedAt: new Date(),
    },
  });
}

const PLANIT_SOURCE = "Council planning register (via PlanIt)";

/**
 * The practice's inbox from its own website: the one on file, else the obvious
 * addresses for its name. Null when the practice isn't known or no site names it.
 */
export async function emailFromPracticeWebsite(
  website: string | null,
  firm: string | null,
  agentName: string | null
): Promise<{ email: string; website: string; note: string } | null> {
  if (!firm) return null;
  // The site on file can be stale (Marrons, on a lead the register gives to JLA),
  // so the guesses are still tried after it.
  for (const site of [...(website ? [website] : []), ...guessWebsites(firm)]) {
    const hit = await findEmailOnWebsite(site, firm, agentName);
    if (hit) return { email: hit.email, website: site, note: `Email from the practice's website (${hit.page})` };
  }
  return null;
}

export async function findAgentContact(
  applicationId: string,
  options?: { force?: boolean }
): Promise<{ ok: boolean; reason?: string; busy?: boolean; result?: ContactResult }> {
  let app = await prisma.planningApplication.findUnique({ where: { id: applicationId } });
  if (!app) return { ok: false, reason: "Application not found" };

  if (!options?.force && app.contactStatus === "found") {
    return { ok: true, reason: "Already researched (pass force to re-run)" };
  }

  // Lambeth publishes no application links in the London feed, so its leads used
  // to go straight to web search. Its register can be searched by reference, and
  // once found the link is kept for Lucy as well as for the reader below.
  if (!app.councilUrl) {
    let resolved: string | null;
    try {
      resolved = await resolveIdoxApplicationUrl(app.council, councilReference(app));
    } catch (error) {
      if (!(error instanceof PortalBusyError)) throw error;
      if (app.contactStatus === "not_found") {
        await prisma.planningApplication.update({ where: { id: applicationId }, data: { contactStatus: null } });
      }
      return { ok: false, busy: true, reason: `${error.message} — left for the next run` };
    }
    if (resolved) {
      app = await prisma.planningApplication.update({
        where: { id: applicationId },
        data: { councilUrl: resolved },
      });
    }
  }

  // Try the council's own register first. It is authoritative, free, and on most
  // Idox registers returns the agent's name, email and phone together. Some
  // registers only name the agent's practice — that is kept as a head start for
  // the web researcher rather than thrown away.
  let fromPortal: PortalContact | null;
  try {
    fromPortal = await extractContactFromPortal(app.councilUrl);
  } catch (error) {
    if (!(error instanceof PortalBusyError)) throw error;
    // The register refused us, which says nothing about whether it names the
    // agent. Put a failed lead back in the daily queue; a found one keeps what
    // it has.
    if (app.contactStatus === "not_found") {
      await prisma.planningApplication.update({ where: { id: applicationId }, data: { contactStatus: null } });
    }
    return { ok: false, busy: true, reason: `${error.message} — left for the next run` };
  }
  if (fromPortal?.agentEmail) {
    const contact = withKnownDetails(fromPortal, app);
    await saveContact(applicationId, { ...contact, agentWebsite: app.agentWebsite, notes: fromPortal.source, found: true });
    return { ok: true, result: { ...contact, agentWebsite: app.agentWebsite, notes: fromPortal.source, found: true } };
  }

  // What is already known before searching: the practice the register named, or
  // the agent details a Surrey council published through PlanIt at ingest.
  const known = withKnownDetails(fromPortal, app);
  // PlanIt relays the council's own agent fields, so a practice it supplied is
  // register data, not a web find, and the card should say so.
  const ingestSource =
    !fromPortal && !app.contactStatus && app.reference.startsWith("PlanIt-") && (app.agentFirm || app.agentName)
      ? PLANIT_SOURCE
      : null;
  const registerSource = fromPortal?.source ?? ingestSource;

  // The practice's own website before a paid web search: it is where the
  // researcher would look anyway, and it can't confuse one practice for another.
  const fromWebsite = await emailFromPracticeWebsite(app.agentWebsite, known.agentFirm, known.agentName);
  if (fromWebsite) {
    const result = {
      ...known,
      agentEmail: fromWebsite.email,
      agentWebsite: app.agentWebsite ?? fromWebsite.website,
      notes: [registerSource, fromWebsite.note].filter(Boolean).join(" — "),
      found: true,
    };
    await saveContact(applicationId, result);
    return { ok: true, result };
  }

  if (!isClaudeConfigured()) {
    if (known.agentName || known.agentFirm) {
      await saveContact(applicationId, { ...known, agentWebsite: app.agentWebsite, notes: registerSource, found: true });
      return { ok: true, result: { ...known, agentWebsite: app.agentWebsite, notes: registerSource, found: true } };
    }
    return { ok: false, reason: "ANTHROPIC_API_KEY not configured" };
  }

  const councilLine = app.councilUrl ? `\n  Council application page: ${app.councilUrl}` : "";
  const applicantLine = app.applicant ? `\n  Applicant/developer named in the feed: ${app.applicant}` : "";
  // A named practice turns this from "who filed it?" into "what is this firm's
  // inbox?", which web search answers far more often.
  const knownLines = [
    known.agentName && `\n  Agent named on the council register: ${known.agentName}`,
    known.agentFirm && `\n  Agent's practice named on the council register: ${known.agentFirm}`,
    known.agentPhone && `\n  Agent phone on the council register: ${known.agentPhone}`,
  ]
    .filter(Boolean)
    .join("");
  // The council's own reference is the one that appears on the planning portal and
  // in the application documents, so it's the one a web search can actually hit.
  // `app.reference` is a GLA document id that exists nowhere outside our database —
  // searching for it returns nothing, which quietly cost us hit rate.
  const searchableRef = councilReference(app) ?? app.reference;

  const prompt = `You are a UK property-sourcing researcher for IdealLand. We have found a planning application in ${app.council} and need to contact the AGENT who submitted it (usually the architect or planning consultant; sometimes the owner directly) to ask whether the owner would sell the site.

Find the agent/architect/planning consultant behind this application and their firm's contact details. If the agent's practice is already named below, confirm it and find that practice's email address and website. Search the council's planning portal page and the web (firm websites, professional directories). Do NOT invent details — only report what you actually find.

Planning application:
  Council: ${app.council}
  Council reference: ${searchableRef}
  Address: ${app.address}
  Description: ${app.description}${applicantLine}${knownLines}${councilLine}

Return ONLY a JSON object, no prose:
{
  "agentName": "<person who filed it, or null>",
  "agentFirm": "<their company/practice, or null>",
  "agentEmail": "<contact email you found, or null>",
  "agentPhone": "<contact phone, or null>",
  "agentWebsite": "<firm website URL, or null>",
  "notes": "<one line on what you found and how confident, or where to look next>"
}`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  await prisma.planningApplication.update({
    where: { id: applicationId },
    data: { contactStatus: "researching" },
  });

  const raw = await runWithWebSearch(client, prompt);
  const parsed = raw ? parseJson<Partial<ContactResult>>(raw) : null;

  if (!parsed) {
    if (known.agentName || known.agentFirm) {
      const result = { ...known, agentWebsite: app.agentWebsite, notes: registerSource, found: true };
      await saveContact(applicationId, result);
      return { ok: true, result };
    }
    await prisma.planningApplication.update({
      where: { id: applicationId },
      data: { contactStatus: "not_found", contactResearchedAt: new Date() },
    });
    return { ok: false, reason: "No contact details resolved" };
  }

  const clean = (v: unknown): string | null =>
    typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : null;

  const rawEmail = clean(parsed.agentEmail);
  const { email: agentEmail, rejected: rejectedEmail } = usableEmail(rawEmail);

  // Only the register says who the agent is. Web search finds the people who run
  // a firm, not who filed the application: it put "Dear Joshua" (Tailored Living's
  // director, from Companies House) on a letter whose agent was Matt Driscoll
  // (Elmbridge 2025/3155, caught by Lucy 1 Oct 2026). A researched name is passed
  // on as a note to check, and the letter opens with the time-of-day greeting.
  const researchedName = clean(parsed.agentName);
  const unconfirmedName =
    !known.agentName && researchedName
      ? `Web research suggests ${researchedName} — not named on the council register, so the letter does not address them; check the application before personalising.`
      : null;
  const result: ContactResult = {
    agentName: known.agentName,
    agentFirm: known.agentFirm ?? clean(parsed.agentFirm),
    agentEmail,
    agentPhone: known.agentPhone ?? clean(parsed.agentPhone),
    agentWebsite: clean(parsed.agentWebsite) ?? app.agentWebsite,
    notes: [registerSource, clean(parsed.notes), unconfirmedName].filter(Boolean).join(" — ") || null,
    found: false,
  };
  // A guessed pattern isn't a contact — surface it as a lead to chase, never as a
  // one-click send, or Lucy mails an address that bounces.
  if (rejectedEmail) {
    result.notes = [
      result.notes,
      `Unverified email pattern returned ("${rejectedEmail}") — not a confirmed address. Identify the individual before sending.`,
    ]
      .filter(Boolean)
      .join(" ");
  }
  // The researcher often finds the practice's site but not the address on it.
  if (!result.agentEmail && result.agentWebsite) {
    const fromSite = await emailFromPracticeWebsite(result.agentWebsite, result.agentFirm, result.agentName);
    if (fromSite) {
      result.agentEmail = fromSite.email;
      result.notes = [result.notes, fromSite.note].filter(Boolean).join(" — ");
    }
  }
  // "Found" means we have something actionable to reach a human with.
  result.found = !!(result.agentEmail || result.agentName || result.agentFirm);

  await saveContact(applicationId, result);
  return { ok: true, result };
}

// The letter carries no sign-off: Lucy sends every approach from her own Gmail,
// which appends her signature, so a "Best wishes / Lucy James" in the body doubled
// it up and she had to delete it by hand each time (her request, 22 Sep 2026).
// James is still copied on each one; see lib/approach-email.ts.
//
// The letter prints no phone number: Lucy offers to set up the call herself.

// A first name is only safe as a greeting when it's a single clean person. Two
// agents joined by "/" or a comma-separated list get the time-of-day greeting.
//
// Registers often put the practice in the agent-name field ("PACE-PM", firm
// "PACE-PM LTD"), which read as "Dear Pace-pm,". A real person comes with a
// surname, so a one-word name, a name carrying a company word, or a name that is
// exactly the firm's name all fall back to the time-of-day greeting. A firm named
// after its principal ("David Bowler" of "David Bowler Associates") still gets
// "Dear David,".
const COMPANY_WORD =
  /\b(ltd|limited|llp|plc|inc|architects?|architecture|planning|associates|consult(ants|ancy|ing)|design|developments?|homes|properties|group|partnership|studio|surveyors|engineering)\b/i;

function comparable(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const TITLE = /^(mr|mrs|ms|miss|mx|dr)\.?$/i;

function properCase(word: string): string {
  return word === word.toUpperCase() ? word.charAt(0) + word.slice(1).toLowerCase() : word;
}

function greeting(agentName: string | null, agentFirm: string | null): string {
  if (!agentName || /[/,&]/.test(agentName)) return timeGreeting();
  const words = agentName.trim().split(/\s+/);
  // "Mr Patel" on the register: "Dear Mr Patel,", never "Dear Mr,".
  if (TITLE.test(words[0])) {
    const surname = words.length > 1 ? words[words.length - 1].replace(/\./g, "") : "";
    if (surname.length < 2 || COMPANY_WORD.test(agentName)) return timeGreeting();
    return `Dear ${properCase(words[0].replace(/\./g, ""))} ${properCase(surname)},`;
  }
  if (words.length < 2 || COMPANY_WORD.test(agentName)) return timeGreeting();
  if (agentFirm && comparable(agentName) === comparable(agentFirm)) return timeGreeting();
  const raw = words[0];
  // Registers often store names in capitals — "Dear PETER," reads like a form letter.
  const first = raw === raw.toUpperCase() ? raw.charAt(0) + raw.slice(1).toLowerCase() : raw;
  // An initial alone ("Dear J,") is worse than a plain "Good morning,".
  return first.replace(/\./g, "").length > 1 ? `Dear ${first},` : timeGreeting();
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function inWords(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

const COUNT = String.raw`(\d+|one|two|three|four|five|six|seven|eight|nine|ten)`;

function countValue(word: string): number {
  return /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS.indexOf(word.toLowerCase());
}

/**
 * The homes as the description counts them: "4 self contained residential
 * units", "3No. residential dwellings", "5, three-storey residential dwellings".
 * The unit field can disagree (it counts a whole site, or the gross figure), and
 * the letter has to say what the agent wrote on the form.
 */
function describedHomes(description: string): { count: number; word: string } | null {
  const pattern = new RegExp(
    String.raw`\b${COUNT},?\s*(?:nos?\.?\s*(?:\d\s*[- ]?bed(?:room)?s?\s+)?|x\s*)?(?:(?:two|three|four|five|[2-5])[- ]stor(?:e)?y\s+)?(?:new\s+|additional\s+|private\s+)?(?:self[- ]contained\s+)?(?:residential\s+)?(flats?|apartments?|maisonettes?|units?|dwellings?|dwelling ?houses?|houses?|homes?|bungalows?)\b`,
    "i"
  );
  const m = description.match(pattern);
  if (!m) return null;
  const count = countValue(m[1]);
  return count > 0 ? { count, word: m[2].toLowerCase() } : null;
}

/** "4 x 2 bedroom units and 2 x 1 bedroom units" -> [{4, 2}, {2, 1}]. */
function bedroomCounts(description: string): Array<{ count: number; beds: number }> {
  const pattern = /(\d+)\s*(?:nos?\.?\s*|x\s*)(\d)\s*[- ]?\s*bed(?:room)?s?\b/gi;
  return [...description.matchAll(pattern)].map((m) => ({ count: Number(m[1]), beds: Number(m[2]) }));
}

/** "four 2-beds and two 1-beds", "two 1-bed flats". */
function bedroomMix(mix: Array<{ count: number; beds: number }>, noun: string): string {
  if (mix.length === 1) return `${inWords(mix[0].count)} ${mix[0].beds}-bed ${noun}`;
  const parts = mix.map((m) => `${inWords(m.count)} ${m.beds}-bed${m.count === 1 ? "" : "s"}`);
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

type HomeKind = "flats" | "houses" | "homes";

function kindOf(word: string | null, description: string): HomeKind {
  if (word && /^(flat|apartment|maisonette)/.test(word)) return "flats";
  if (word && /^(house|dwelling ?house|bungalow)/.test(word)) return "houses";
  if (/\b(flats?|apartments?|maisonettes?)\b/i.test(description)) return "flats";
  if (!word && /\b(houses?|dwelling-?houses?|bungalows?|semi-detached)\b/i.test(description)) return "houses";
  return "homes";
}

function homesNoun(kind: HomeKind, count: number): string {
  if (count === 1) return kind === "flats" ? "new flat" : kind === "houses" ? "new house" : "new home";
  return `${inWords(count)} ${kind === "homes" ? "new homes" : kind}`;
}

/**
 * What the scheme is, in the words an agent would use for it: "three-storey
 * block of four 2-beds and two 1-beds", "six houses", "conversion into two flats".
 * Read straight off the council's description, never guessed; anything it can't
 * read with confidence falls back to "six new homes".
 *
 * Lucy (7 Oct 2026): an agent wrote back that we hadn't done our homework. A
 * letter that names the actual scheme shows somebody looked at it.
 */
export function schemePhrase(description: string | null, units: number): string {
  const d = (description ?? "").replace(/\s+/g, " ");

  // Only a scheme that ends as an HMO is one; converting an HMO into flats isn't.
  if (/\b(?:to|into|as|form)\s+(?:a |an )?[\w\s,()-]{0,40}?\b(HMO|house in multiple occupation)\b/i.test(d)) {
    return "HMO conversion";
  }

  // A bedroom mix is used only when it accounts for every home the description counts.
  const described = describedHomes(d);
  const counts = bedroomCounts(d);
  const mixTotal = counts.reduce((sum, m) => sum + m.count, 0);
  const useMix = counts.length > 0 && (!described || described.count === mixTotal);
  const count = useMix ? mixTotal : described?.count ?? units;
  const kind = kindOf(described?.word ?? null, d);
  const noun = kind === "houses" ? "house" : "flat";
  const homes = useMix ? bedroomMix(counts, count === 1 ? noun : `${noun}s`) : homesNoun(kind, count);

  if (/\b(change of use|conversion|convert(?:ed|ing)?)\b/i.test(d)) return `conversion into ${homes}`;

  const storeys = d.match(/\berection of (?:a |one |new )*(two|three|four|five|six|[2-6])[- ]stor(?:e)?y (?:building|block)\b/i);
  if (storeys && kind !== "houses") {
    const height = /^\d$/.test(storeys[1]) ? inWords(Number(storeys[1])) : storeys[1].toLowerCase();
    return `${height}-storey block of ${homes}`;
  }
  return homes;
}

/** "August 2024", in London time, or null when the date is missing. */
function monthYear(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Europe/London" }).format(d);
}

/**
 * Lucy's wording (7 Oct 2026). She sends the letter herself and books the call,
 * with James on it, so it offers to arrange one rather than printing a number.
 */
function chatOffer(): string {
  return "If you would prefer to have a chat please let me know and I will set up a call with my managing director, James.";
}

/** "23 Four Wents", "23 Four Wents and 49 High Street", "… and a few other sites". */
function earlierSitesPhrase(addresses: string[]): string {
  const [latest, second] = addresses.map(shortAddress);
  if (addresses.length === 1) return latest;
  if (addresses.length === 2) return `${latest} and ${second}`;
  return `${latest} and a few other sites`;
}

/**
 * Only an explicit grant earns the "you have received planning permission" letter.
 *
 * `status === "decided"` means the council reached a decision, not that it said
 * yes — about a quarter of decided applications in the London feed are refusals,
 * with withdrawals and lapses beyond that. Congratulating an agent on a permission
 * their client was refused is the kind of mistake that ends the conversation, so
 * anything that isn't a clear approval gets the neutral letter instead. A refused
 * applicant is often the more willing seller anyway.
 */
function isApproval(decision: string | null | undefined): boolean {
  if (!decision) return false;
  const d = decision.trim().toLowerCase();
  if (/refus|reject|withdraw|lapsed|declined|closed|not required/.test(d)) return false;
  return /approv|grant|permit|consent|allowed/.test(d);
}

/**
 * The contact we find is the agent who filed the application, almost never the
 * owner. Asking the agent "are you selling the site?" reads as if we think they
 * own it, and leaves out the introduction fee that makes the reply worth their
 * while. Only when the person we reach is the applicant themselves does the
 * letter speak to them as the owner.
 */
function writingToApplicant(app: { agentName: string | null; agentFirm: string | null; applicant: string | null }): boolean {
  if (!app.applicant) return false;
  const applicant = comparable(app.applicant);
  if (!applicant) return false;
  return [app.agentName, app.agentFirm].some((name) => !!name && comparable(name) === applicant);
}

// Lucy's letter, rewritten with her on 7 Oct 2026 after an agent replied that it
// read like a mass mailing and that we hadn't done our homework. It no longer
// claims a client ready to buy the site; it names the scheme, says when it went
// in or was approved, and asks one question. The council reference leads the
// subject, the way one professional writes to another. Deterministic on purpose:
// this is her voice, so no paraphrasing and no LLM.
export function buildApproachEmail(app: {
  agentName: string | null;
  agentFirm: string | null;
  applicant: string | null;
  units: number;
  address: string;
  status: string;
  decision: string | null;
  description?: string | null;
  council?: string;
  reference?: string;
  lpaReference?: string | null;
  submittedAt?: Date | string | null;
  decidedAt?: Date | string | null;
  /** Sites this agent has already had a letter about, most recent first. */
  earlierSites?: string[];
}): { subject: string; body: string } {
  const letter = writeApproachEmail(app);
  return { subject: plainDashes(letter.subject), body: plainDashes(letter.body) };
}

type LetterInput = Parameters<typeof buildApproachEmail>[0];

function writeApproachEmail(app: LetterInput): { subject: string; body: string } {
  const hasPlanning = app.status === "decided" && isApproval(app.decision);
  const toOwner = hasPlanning && writingToApplicant(app);
  const open = greeting(app.agentName, app.agentFirm);
  const address = formatAddress(app.address);
  const scheme = schemePhrase(app.description ?? null, app.units);
  const council = app.council?.trim() || "the council";

  // "...that Greenwich approved in August 2024" / "...that went in to Merton in May 2026".
  const approved = monthYear(app.decidedAt);
  const submitted = monthYear(app.submittedAt);
  const when = hasPlanning
    ? `that ${council} approved${approved ? ` in ${approved}` : ""}`
    : submitted
      ? `that went in to ${council} in ${submitted}`
      : `with ${council}`;

  const ref = app.reference && app.council
    ? councilReference({ reference: app.reference, council: app.council, lpaReference: app.lpaReference })
    : app.lpaReference?.trim() || null;
  const site = shortAddress(app.address);
  const subject = ref ? `${ref} - ${site}` : `Your scheme at ${site}`;

  const fees = toOwner
    ? "There's no fee to you, as our buyers pay us."
    : "There's no fee to your client, as our buyers pay us, and we're happy to agree an introduction fee with you.";

  // Lucy (7 Oct 2026): an agent who has already had a letter shouldn't get the
  // same one again, so the second letter mentions the first and is worded afresh.
  const earlier = app.earlierSites?.length ? earlierSitesPhrase(app.earlierSites) : null;
  if (earlier) {
    return {
      subject,
      body: `${open}

I wrote to you recently about ${earlier}, and I've now seen your scheme at ${address} - the ${scheme} ${when}.

${toOwner ? "Would you be open to selling this one, or are you planning to build it yourself?" : "Would your client be open to selling this one, or are they planning to build it themselves?"}

As before, we find sites for developers who are buying in ${buyingArea(council)}. ${fees}

${chatOffer()}`,
    };
  }

  return {
    subject,
    body: `${open}

I was looking at ${toOwner ? "your site" : "your scheme"} at ${address} - the ${scheme} ${when}.

${toOwner ? "Do you plan to build it yourself, or would you be open to selling?" : "Do you know if your client plans to build it themselves, or would they be open to selling?"}

We find sites for developers who are buying in ${buyingArea(council)}. If a sale is on the cards, I'd want to look at it properly with ${toOwner ? "you" : "them"} before talking numbers. ${fees}

${chatOffer()}`,
  };
}

/**
 * Every site already written about, grouped by agent, most recent first. One
 * query for a whole batch of letters (the nightly self-check checks ~100).
 */
export async function sentSitesByAgent(): Promise<Map<string, Array<{ id: string; address: string }>>> {
  const sent = await prisma.planningApplication.findMany({
    where: { approachStatus: "sent" },
    orderBy: { approachSentAt: "desc" },
    select: { id: true, address: true, agentName: true, agentEmail: true, agentFirm: true },
  });
  return groupByAgent(sent);
}

/** The other sites this lead's agent has had a letter about. */
/**
 * The other sites this lead's agent has had a letter about. Another application
 * on the same site isn't another site ("I wrote to you about X, and now your
 * application at X"), and a site written about twice is named once.
 */
export function earlierSitesFor(
  lead: { id: string; address: string; agentName: string | null; agentEmail: string | null; agentFirm: string | null },
  byAgent: Map<string, Array<{ id: string; address: string }>>
): string[] {
  const site = (address: string) => shortAddress(address).toLowerCase().replace(/[^a-z0-9]/g, "");
  const seen = new Set([site(lead.address)]);
  const earlier: string[] = [];
  for (const s of sameAgentIn(lead, byAgent)) {
    if (s.id === lead.id || seen.has(site(s.address))) continue;
    seen.add(site(s.address));
    earlier.push(s.address);
  }
  return earlier;
}

export async function draftApproach(
  applicationId: string,
  options?: { force?: boolean; byAgent?: Map<string, Array<{ id: string; address: string }>> }
): Promise<{ ok: boolean; reason?: string; subject?: string; body?: string }> {
  const app = await prisma.planningApplication.findUnique({ where: { id: applicationId } });
  if (!app) return { ok: false, reason: "Application not found" };
  if (!options?.force && app.approachStatus && app.approachBody) {
    return { ok: true, reason: "Already drafted", subject: app.approachSubject ?? "", body: app.approachBody };
  }

  const { subject, body } = buildApproachEmail({
    ...app,
    earlierSites: earlierSitesFor(app, options?.byAgent ?? (await sentSitesByAgent())),
  });

  await prisma.planningApplication.update({
    where: { id: applicationId },
    data: {
      approachSubject: subject,
      approachBody: body,
      // A letter Lucy set aside stays set aside when its wording is refreshed.
      approachStatus: app.approachStatus === "discarded" || app.approachStatus === "pending" ? app.approachStatus : "drafted",
    },
  });

  return { ok: true, subject, body };
}

// Run contact discovery across the best undone leads. Newest, highest-scored,
// not-yet-researched, still-open applications first.
function portalHost(url: string | null): string | null {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

export async function bulkFindContacts(options?: {
  minScore?: number;
  limit?: number;
  autoDraft?: boolean;
}): Promise<{ processed: number; found: number; drafted: number; reason?: string }> {
  if (!isClaudeConfigured()) return { processed: 0, found: 0, drafted: 0, reason: "ANTHROPIC_API_KEY not configured" };

  const minScore = options?.minScore ?? Number(process.env.CONTACT_MIN_LEAD_SCORE ?? 7);
  const limit = Math.min(options?.limit ?? 5, 40);
  const autoDraft = options?.autoDraft ?? false;

  // publicOwner excluded: researching land the council already owns spends real
  // money (a Claude call plus web searches) on a site that can never be brokered.
  // Live applications, plus decided ones the council APPROVED — a site with fresh
  // permission is the strongest letter Lucy sends, and those were being skipped
  // entirely. Refusals and withdrawals stay out.
  const base = {
    ...inCoverage,
    leadScore: { gte: minScore },
    contactStatus: null,
    publicOwner: false,
    OR: [{ status: { not: "decided" } }, { decision: { contains: "Approv" } }, { decision: { contains: "Grant" } }],
  };
  const order = [{ leadScore: "desc" as const }, { submittedAt: "desc" as const }];

  // A council portal link is the finder's strongest signal (it confirms the
  // application and often names the agent), so spend the budget on those leads
  // first, then backfill with link-less leads to use any remaining slots.
  const withUrl = await prisma.planningApplication.findMany({
    where: { ...base, councilUrl: { not: null } },
    orderBy: order,
    take: limit,
    select: { id: true, councilUrl: true, council: true },
  });
  const remaining = limit - withUrl.length;
  const withoutUrl = remaining > 0
    ? await prisma.planningApplication.findMany({
        where: { ...base, councilUrl: null },
        orderBy: order,
        take: remaining,
        select: { id: true, councilUrl: true, council: true },
      })
    : [];
  const candidates = [...withUrl, ...withoutUrl];

  let found = 0;
  let drafted = 0;
  // A register that refused one lead will refuse the next; leave its other leads
  // for the next run rather than keep knocking.
  const busyHosts = new Set<string>();
  for (const c of candidates) {
    // A lead with no link is looked up through its council's search, which can be
    // down as a whole (Lambeth), so that counts as the council's host.
    const host = portalHost(c.councilUrl) ?? `search:${c.council}`;
    if (host && busyHosts.has(host)) continue;
    const r = await findAgentContact(c.id);
    if (!r.ok && host && r.busy) busyHosts.add(host);
    if (r.ok && r.result?.found) {
      found++;
      if (autoDraft) {
        const d = await draftApproach(c.id);
        if (d.ok) drafted++;
      }
    }
  }
  return { processed: candidates.length, found, drafted };
}

const APPROACH_OUTCOMES = ["replied", "interested", "dead", "won"] as const;
export type ApproachOutcome = (typeof APPROACH_OUTCOMES)[number];

export function isApproachOutcome(v: string): v is ApproachOutcome {
  return (APPROACH_OUTCOMES as readonly string[]).includes(v);
}

// Staff sends the approach from their own email/LinkedIn, then records what
// happened here so the ROI pipeline has a measurable end.
//
// "sent" also covers a site Lucy approached some other way — a letter written
// before the system found it, or a phone call — so it stops appearing in her
// to-do lists. "discarded" is a letter Lucy decided not to send (it doesn't look
// right, or the agent has had enough letters); it leaves Ready to Send without
// counting as sent. "pending" is a letter on hold while someone reaches the
// agent another way (James WhatsApps architects he knows) — off Ready to Send
// until it's sent or brought back. "not_sent" undoes any of them: the draft goes back to Ready to
// Send and any outcome recorded against it is cleared.
export async function setApproachState(
  applicationId: string,
  changes: { status?: "drafted" | "sent" | "not_sent" | "discarded" | "pending"; outcome?: ApproachOutcome | null }
): Promise<{ ok: boolean; reason?: string }> {
  const app = await prisma.planningApplication.findUnique({ where: { id: applicationId } });
  if (!app) return { ok: false, reason: "Application not found" };

  const data: Record<string, unknown> = {};
  if (changes.status === "not_sent") {
    data.approachStatus = app.approachBody ? "drafted" : null;
    data.approachSentAt = null;
    data.approachOutcome = null;
    data.approachOutcomeAt = null;
  } else if (changes.status) {
    data.approachStatus = changes.status;
    if (changes.status === "sent" && app.approachStatus !== "sent") data.approachSentAt = new Date();
  }
  if (changes.outcome !== undefined && changes.status !== "not_sent") {
    data.approachOutcome = changes.outcome;
    data.approachOutcomeAt = changes.outcome ? new Date() : null;
    // Someone can only come back to a site that was approached.
    if (changes.outcome && app.approachStatus !== "sent") {
      data.approachStatus = "sent";
      data.approachSentAt = new Date();
    }
  }
  if (Object.keys(data).length === 0) return { ok: false, reason: "Nothing to update" };

  await prisma.planningApplication.update({ where: { id: applicationId }, data });
  if (changes.status) await redraftForAgent(app);
  return { ok: true };
}

/**
 * Once a letter to an agent is sent (or un-sent), that agent's other waiting
 * letters are reworded to match — the next one mentions the site just written about.
 */
async function redraftForAgent(app: {
  id: string;
  agentName: string | null;
  agentEmail: string | null;
  agentFirm: string | null;
}): Promise<void> {
  const keys = new Set(agentKeys(app));
  if (keys.size === 0) return;
  const waiting = await prisma.planningApplication.findMany({
    where: {
      id: { not: app.id },
      approachStatus: { in: ["drafted", "discarded", "pending"] },
      approachBody: { not: null },
      OR: [{ agentEmail: { not: null } }, { agentFirm: { not: null } }, { agentName: { not: null } }],
    },
    select: { id: true, agentName: true, agentEmail: true, agentFirm: true },
  });
  const sameAgent = waiting.filter((w) => agentKeys(w).some((k) => keys.has(k)));
  if (sameAgent.length === 0) return;
  const byAgent = await sentSitesByAgent();
  for (const w of sameAgent) await draftApproach(w.id, { force: true, byAgent });
}

export interface LeadEdits {
  agentName?: string | null;
  agentEmail?: string | null;
  note?: string | null;
  followUpAt?: string | null;
}

/**
 * Lucy's own corrections and notes. A name or email she types is taken as
 * confirmed — she has read the application form, which the register reader
 * can't (Reigate keeps it behind a captcha) — and an unsent letter is rewritten
 * so its greeting follows. Sent letters are history; only the contact changes.
 */
export async function updateLeadDetails(
  applicationId: string,
  edits: LeadEdits
): Promise<{ ok: boolean; reason?: string }> {
  const app = await prisma.planningApplication.findUnique({ where: { id: applicationId } });
  if (!app) return { ok: false, reason: "Application not found" };

  const text = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
  const data: Record<string, unknown> = {};

  if (edits.agentName !== undefined) data.agentName = text(edits.agentName);
  if (edits.agentEmail !== undefined) {
    const typed = text(edits.agentEmail);
    if (typed && !usableEmail(typed).email) return { ok: false, reason: "That doesn't look like a single email address" };
    data.agentEmail = typed;
  }
  if (edits.note !== undefined) data.staffNote = text(edits.note);
  if (edits.followUpAt !== undefined) {
    // A calendar day from the date picker, stored at midday UTC so it reads as the
    // same day in London or on a laptop in another time zone.
    const day = edits.followUpAt?.slice(0, 10);
    const date = day ? new Date(`${day}T12:00:00Z`) : null;
    if (date && Number.isNaN(date.getTime())) return { ok: false, reason: "Invalid follow-up date" };
    data.followUpAt = date;
  }
  if (Object.keys(data).length === 0) return { ok: true };

  const contactChanged = edits.agentName !== undefined || edits.agentEmail !== undefined;
  if (contactChanged) {
    if (data.agentName || data.agentEmail || app.agentFirm) data.contactStatus = "found";
    const earlier = app.contactNotes?.startsWith(ENTERED_BY_LUCY)
      ? app.contactNotes.split(" — ").slice(1).join(" — ")
      : app.contactNotes;
    data.contactNotes = [`${ENTERED_BY_LUCY} ${new Date().toLocaleDateString("en-GB")}`, earlier].filter(Boolean).join(" — ");
  }

  await prisma.planningApplication.update({ where: { id: applicationId }, data });
  if (contactChanged && app.approachBody && app.approachStatus !== "sent") {
    await draftApproach(applicationId, { force: true });
  }
  return { ok: true };
}
