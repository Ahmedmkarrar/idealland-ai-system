// Addressing and last-moment tidying for the seller-approach email.
//
// The dashboard never sends: staff hit Copy or Open in email and it leaves from
// their own mailbox. So these are the only levers we have over who receives a
// copy and what the greeting says at the moment it actually goes out.

/** James is copied so he sees every approach Lucy sends. */
export const APPROACH_CC =
  process.env.NEXT_PUBLIC_IDEALLAND_APPROACH_CC ?? "james@idealland.co.uk";

/** Lucy is blind-copied — she files them, and the agent needn't see that. */
export const APPROACH_BCC =
  process.env.NEXT_PUBLIC_IDEALLAND_APPROACH_BCC ?? "admin@idealland.co.uk";

/** "Good morning," before noon in London, "Good afternoon," after. */
export function timeGreeting(now: Date = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric", hour12: false, timeZone: "Europe/London",
    }).format(now)
  );
  return hour < 12 ? "Good morning," : "Good afternoon,";
}

/**
 * Drafts are written ahead of time — the overnight job writes them at 08:00 and
 * they may not be sent for days. Rather than let a letter go out saying "Good
 * morning" at four in the afternoon, the greeting is refreshed at the moment it
 * is copied or opened. Only a leading time-of-day greeting is touched; "Dear
 * Simon," is left exactly as written.
 */
export function refreshGreeting(body: string | null, now: Date = new Date()): string {
  if (!body) return "";
  return body.replace(/^\s*Good (morning|afternoon),/i, timeGreeting(now));
}

/** mailto: with the approach ready to send, cc'd and bcc'd per Lucy's request. */
export function approachMailto(
  to: string,
  subject: string | null,
  body: string | null
): string {
  const params = new URLSearchParams({
    subject: subject ?? "",
    body: refreshGreeting(body),
  });
  if (APPROACH_CC.trim()) params.set("cc", APPROACH_CC.trim());
  if (APPROACH_BCC.trim()) params.set("bcc", APPROACH_BCC.trim());
  return `mailto:${to}?${params}`;
}

/**
 * The same agent, by inbox or practice. Shared by the Ready page ("you've
 * already written to this agent") and the letter writer, which words a second
 * letter to the same agent differently.
 */
export function agentKey(lead: { agentEmail: string | null; agentFirm: string | null }): string | null {
  const email = lead.agentEmail?.trim().toLowerCase();
  if (email) return email;
  const firm = lead.agentFirm?.toLowerCase().replace(/\b(ltd|limited|llp)\b/g, "").replace(/[^a-z0-9]/g, "");
  return firm || null;
}

/**
 * Lucy (7 Oct 2026): a long dash is a giveaway that a machine wrote the letter.
 * Every dash in a letter, including any that arrive inside an address, is the
 * short one she types herself.
 */
export function plainDashes(text: string): string {
  return text.replace(/\s*[\u2014\u2013]\s*/g, " - ");
}

// Words that stay lower case inside an address ("Land to the Rear of…").
const ADDRESS_SMALL_WORDS = new Set([
  "a", "an", "and", "at", "by", "for", "in", "of", "on", "the", "to", "with",
  "rear", "adjacent", "adjoining", "behind", "between", "opposite",
]);
const ADDRESS_KEEP_UPPER = new Set(["LLP", "PLC", "UK", "NHS", "YMCA", "BT"]);
const POSTCODE_OUTWARD = /^[A-Z]{1,2}\d[A-Z\d]?$/;
const POSTCODE_INWARD = /^\d[A-Z]{2}$/;

function capitalise(part: string): string {
  const lower = part.toLowerCase();
  if (/^mc[a-z]{2,}/.test(lower)) return "Mc" + lower.charAt(2).toUpperCase() + lower.slice(3);
  return lower.replace(/[a-z]/, (c) => c.toUpperCase());
}

function bareWord(word: string): string {
  return word.replace(/[^A-Za-z0-9']/g, "");
}

function formatAddressWord(word: string, previous: string | null): string {
  const bare = bareWord(word);
  const followsPostcode = previous !== null && POSTCODE_OUTWARD.test(previous);
  if (POSTCODE_OUTWARD.test(bare) || (followsPostcode && POSTCODE_INWARD.test(bare)) || ADDRESS_KEEP_UPPER.has(bare)) {
    return word;
  }
  // House numbers keep their letter ("15A"); ordinals read "1st", not "1ST".
  if (/^\d/.test(bare)) return word.replace(/^(\d+)(ST|ND|RD|TH)\b/, (_, n, s) => n + s.toLowerCase());
  // "22 THE VILLAGE" is a street name, so "The" after a house number keeps its capital.
  const startsName = previous === null || (/^\d/.test(previous) && bare.toLowerCase() === "the");
  if (!startsName && ADDRESS_SMALL_WORDS.has(bare.toLowerCase())) return word.toLowerCase();
  return word
    .split("-")
    .map((part) =>
      part
        .split("'")
        // "JOHN'S" → "John's", "O'BRIEN" → "O'Brien".
        .map((piece, i) => (i > 0 && piece.replace(/[^A-Za-z]/g, "").length <= 1 ? piece.toLowerCase() : capitalise(piece)))
        .join("'")
    )
    .join("-");
}

/**
 * Council registers often store the address in capitals, which reads as shouting
 * in a letter ("8 FERNHILL OXSHOTT…"). An all-caps address is put into title case
 * with the postcode kept upper case; one that already has lower case letters was
 * typed by a person and is left exactly as it is.
 */
/**
 * The London feed writes the house number as its own field: "65, Kingsmead
 * Avenue", "20, 22, Gipsy Hill". In a letter that reads as "65 Kingsmead Avenue"
 * and "20 and 22 Gipsy Hill", the way Lucy writes "87 and 89 Manor Road North".
 */
function joinHouseNumbers(address: string): string {
  const num = String.raw`\d+[A-Za-z]?(?:\s*-\s*\d+[A-Za-z]?)?`;
  return address
    .replace(new RegExp(`^(${num}),\\s*(${num}),\\s*`), "$1 and $2 ")
    .replace(new RegExp(`^(${num}),\\s*`), "$1 ");
}

/**
 * True when the address names no house, number or site — "Mitcham, CR4 2PF",
 * "Leatherhead Road" — so the letter can't say where the site is.
 */
export function addressLooksIncomplete(address: string): boolean {
  const first = address.trim().split(",")[0].trim();
  if (/\d/.test(first) || /^(land|site|plot|garages?|car park|former|rear)\b/i.test(first)) return false;
  const words = first.split(/\s+/);
  // A bare street ("Slievemore Close") or a bare town ("Mitcham"); a named house
  // ("Rose Cottage") or a long description is left alone.
  return words.length === 1 || (words.length <= 3 && STREET_WORD.test(words[words.length - 1]));
}

const STREET_WORD =
  /^(road|street|avenue|lane|close|way|drive|gardens|grove|hill|park|crescent|place|terrace|mews|rise|walk|square)$/i;

export function formatAddress(address: string): string {
  const trimmed = joinHouseNumbers(address.trim());
  if (/[a-z]/.test(trimmed) || !/[A-Z]/.test(trimmed)) return trimmed;
  let previous: string | null = null;
  return trimmed
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token)) return token;
      const formatted = formatAddressWord(token, previous);
      previous = bareWord(token);
      return formatted;
    })
    .join("");
}
