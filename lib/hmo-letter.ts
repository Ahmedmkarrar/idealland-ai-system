// The HMO approach letter, posted to the licence holder. Councils publish a
// correspondence address on the licensing register but never an email, so this
// one is printed and posted rather than sent from the dashboard.
//
// Written in Lucy's voice from her planning-letter rewrite (7 Oct 2026): one
// question, no claimed buyer, no long dashes, no AI paraphrase. The earlier
// Claude-written letters ended in an "[IdealLand — name, phone, email]"
// placeholder and told owners we had "interested parties" lined up (8 Oct 2026).
import { plainDashes } from "@/lib/approach-email";

const SENDER = {
  signature: "James",
  name: "James Armstrong",
  title: "Managing Director",
  company: "IdealLand",
  phone: "07973 445901",
  website: "www.idealland.co.uk",
};

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const inWords = (n: number) => NUMBER_WORDS[n] ?? String(n);

/**
 * Lucy (8 Oct 2026): nobody can click a posted letter, so the printed letter
 * carries QR codes that open WhatsApp or email to James with a reply already
 * written, naming the property so he knows which letter it answers. The number
 * is James's (Lucy, 9 Oct 2026), and she asked for an email option too.
 */
const JAMES_EMAIL = "james@idealland.co.uk";

const replyText = (propertyAddress: string) =>
  `Hi James, I got your letter about ${propertyLine(propertyAddress)}. I'd be happy to have a chat.`;

export function whatsappReplyUrl(propertyAddress: string): string {
  const number = "44" + SENDER.phone.replace(/\D/g, "").replace(/^0/, "");
  return `https://wa.me/${number}?text=${encodeURIComponent(replyText(propertyAddress))}`;
}

export function emailReplyUrl(propertyAddress: string): string {
  const subject = `Your letter about ${propertyLine(propertyAddress)}`;
  return `mailto:${JAMES_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(replyText(propertyAddress))}`;
}

export const QR_HEADING = "Scan a QR code with your phone camera for our direct contact details:";

export const QR_OPTIONS = [
  { url: whatsappReplyUrl, caption: `WhatsApp or call James\n${SENDER.phone}` },
  { url: emailReplyUrl, caption: `Email James\n${JAMES_EMAIL}` },
];

const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\s*$/i;
const TITLES: Record<string, string> = {
  mr: "Mr", mrs: "Mrs", ms: "Ms", miss: "Miss", mx: "Mx", dr: "Dr", doctor: "Dr", prof: "Professor", professor: "Professor",
};
const COMPANY_WORD = /\b(ltd|limited|llp|plc|company|holdings|properties|property|estates|investments|trust|partnership|association|group|management)\b/i;

/** Residents' associations and freeholder companies hold licences for blocks they manage, not sell. */
export function notASeller(holderName: string | null): boolean {
  return !!holderName && /\bresidents?'?\b|\bfreehold\b|\bmanagement company\b|\bRTM\b/i.test(holderName);
}

export interface HmoLetterInput {
  holderName: string | null;
  holderAddress: string | null;
  propertyAddress: string;
  council: string;
  ownerType: string | null;
  portfolioSize: number;
}

function personGreeting(holderName: string): string | null {
  const words = holderName.replace(/[.,]/g, " ").trim().split(/\s+/);
  const title = TITLES[words[0]?.toLowerCase() ?? ""];
  if (!title || words.length < 2 || COMPANY_WORD.test(holderName)) return null;
  return `Dear ${title} ${words[words.length - 1]},`;
}

/** "Flat B 8 Orde Hall Street London WC1N 3JW" → "Flat B 8 Orde Hall Street, WC1N 3JW". */
export function propertyLine(address: string): string {
  const match = address.match(UK_POSTCODE);
  const postcode = match ? `${match[1].toUpperCase()} ${match[2].toUpperCase()}` : null;
  const street = (match ? address.slice(0, match.index) : address)
    .replace(/\b(greater\s+)?london\b/gi, "")
    .replace(/[\s,]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return postcode ? `${street}, ${postcode}` : street;
}

/** The address block at the top of the page: name, then the address with its postcode on its own line. */
function addressBlock(p: HmoLetterInput): string {
  const addressee = p.holderName
    ? /\b(limited|ltd|plc|llp)\.?$/i.test(p.holderName.trim()) ? `The Directors\n${p.holderName}` : p.holderName
    : "The Licence Holder";
  if (!p.holderAddress) return addressee;
  const match = p.holderAddress.match(UK_POSTCODE);
  const lines = match
    ? [p.holderAddress.slice(0, match.index).replace(/[\s,]+$/, ""), `${match[1].toUpperCase()} ${match[2].toUpperCase()}`]
    : [p.holderAddress];
  return [addressee, ...lines].join("\n");
}

export function buildHmoLetter(p: HmoLetterInput, today: Date = new Date()): string {
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }).format(today);
  const open = (p.holderName && p.ownerType !== "company" && personGreeting(p.holderName)) || "Dear Sir or Madam,";
  const property = propertyLine(p.propertyAddress);
  const others = p.portfolioSize - 1;

  const intro =
    others > 0
      ? `I'm writing about ${property}, one of ${inWords(p.portfolioSize)} HMOs on ${p.council}'s licensing register under your name.`
      : `I'm writing about ${property}, which ${p.council}'s licensing register shows under your name as a licensed HMO.`;
  const question =
    others === 1
      ? "Would you consider selling it, or the other one, either on its own or together?"
      : others > 1
        ? "Would you consider selling it, or any of the others, either one at a time or together?"
        : "Would you ever consider selling it?";

  const body = `${addressBlock(p)}

${date}

${open}

${intro}

${question}

We find property for buyers who are acquiring HMOs in London. If a sale is on the cards, I'd want to look at it properly with you before talking numbers. There's no fee to you, as our buyers pay us.

If you're not the owner, I'd be grateful if you could pass this on to them.

If you would like to have a chat, please give me a call.

Kind regards,

${SENDER.signature}

${SENDER.name}
${SENDER.title}
${SENDER.company}
${SENDER.phone}
${SENDER.website}`;

  return plainDashes(body);
}
