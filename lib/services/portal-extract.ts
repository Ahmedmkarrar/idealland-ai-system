// Reading the agent straight off the council's own planning register.
//
// This is the job Lucy does by hand, and the thing the AI researcher kept failing
// at — its own notes said so repeatedly: "unable to access the council planning
// portal directly", "Salesforce-based system not crawlable". Web search can't read
// these pages. But they aren't protected, and most aren't even JavaScript: Idox's
// "Contacts" tab is plain server-rendered HTML that returns
//
//   <div class="agents">
//     <h3>Agent</h3>
//     <p>Saroop Saroop Hanspal</p>
//     <table class="agents">
//       <tr><th>Address</th><td>75 Stapleton Road, Bexleyheath…</td></tr>
//       <tr><th>Personal Email</th><td>…@gmail.com</td></tr>
//       <tr><th>Personal Mobile</th><td>078…</td></tr>
//     </table>
//   </div>
//
// — the name, email and phone, published by the council, authoritative, free, and
// with no model in the loop to invent anything. Idox is 639 of the leads that
// carry a portal link, by far the largest platform.
//
// This is public register data that councils publish precisely so people can see
// who is developing what. It is still someone's personal email, so: one request
// per application, a real User-Agent identifying us, a pause between requests, and
// no bulk harvesting beyond the leads actually being worked.

import { withRetry } from "@/lib/retry";
import { usableEmail } from "@/lib/email-address";

export interface PortalContact {
  agentName: string | null;
  agentFirm: string | null;
  agentEmail: string | null;
  agentPhone: string | null;
  /** Which platform and section it came from, for the audit trail shown to staff. */
  source: string;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Politeness gap between requests to the same council. */
export const PORTAL_REQUEST_DELAY_MS = Number(process.env.PORTAL_DELAY_MS ?? 1500);

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await withRetry(() =>
      fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(25000),
      })
    );
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'",
};
function decode(v: string): string {
  return v
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&apos;|&#39;/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Idox concatenates title + forename + surname from separate fields, and the
 * forename is usually stored in both, so the register hands back "Mr Pete Pete
 * Tanner", "Saroop Saroop Hanspal", "PETER Peter Munnelly". Left alone the letter
 * would open "Dear Mr," — the greeting takes the first word — so the title goes
 * and consecutive repeats collapse, keeping the better-capitalised copy.
 */
export function cleanAgentName(raw: string | null): string | null {
  if (!raw) return null;
  let words = raw.trim().split(/\s+/);
  words = words.filter((w, i) => !(i === 0 && /^(mr|mrs|ms|miss|dr|prof|sir|rev)\.?$/i.test(w)));
  const out: string[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev && prev.toLowerCase() === w.toLowerCase()) {
      // Keep "Peter" over "PETER"; an all-caps duplicate is the lower-quality one.
      if (prev === prev.toUpperCase() && w !== w.toUpperCase()) out[out.length - 1] = w;
      continue;
    }
    out.push(w);
  }
  const name = out.join(" ").trim();
  return name.length > 1 ? name : null;
}

/** An agent's postal address often names the practice on its first line. */
function firmFromAddress(address: string | null, name: string | null): string | null {
  if (!address) return null;
  const first = address.split(",")[0]?.trim();
  if (!first) return null;
  // A street address ("75 Stapleton Road") is not a firm name; a practice usually
  // isn't just a number and a road.
  if (/^\d+[a-z]?\s/i.test(first) || /\b(road|street|lane|avenue|close|way|drive|court)\b/i.test(first)) {
    return null;
  }
  if (name && first.toLowerCase() === name.toLowerCase()) return null;
  return first;
}

/**
 * Idox Public Access. The application page carries the contacts under
 * `?activeTab=contacts`; everything we need is in `<div class="agents">`.
 */
export function idoxContactsUrl(councilUrl: string): string | null {
  if (!/online-applications\/applicationDetails\.do/i.test(councilUrl)) return null;
  const url = councilUrl.replace(/([?&])activeTab=[^&]*/gi, "$1activeTab=contacts");
  return /activeTab=contacts/i.test(url)
    ? url
    : `${url}${url.includes("?") ? "&" : "?"}activeTab=contacts`;
}

function parseIdox(html: string): PortalContact | null {
  // The agent block, up to the next sibling section (applicants / councillors).
  const block = html.match(/<div class="agents">([\s\S]*?)<\/div>/i)?.[1];
  if (!block) return null;

  const name = cleanAgentName(decode(block.match(/<h3>\s*Agent\s*<\/h3>\s*<p>([\s\S]*?)<\/p>/i)?.[1] ?? "") || null);

  const fields = new Map<string, string>();
  for (const row of block.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    const key = decode(row[1]).toLowerCase();
    const value = decode(row[2]);
    if (key && value) fields.set(key, value);
  }

  const pick = (...keys: string[]) => {
    for (const k of keys) {
      for (const [key, value] of fields) if (key.includes(k)) return value;
    }
    return null;
  };

  // Company details before personal ones — a practice inbox survives the
  // individual moving on, and is the more appropriate address to write to.
  const rawEmail = pick("company email", "email");
  const phone = pick("company phone", "phone", "mobile", "telephone");
  const address = pick("address");

  const { email } = usableEmail(rawEmail);
  if (!name && !email && !phone) return null;

  return {
    agentName: name,
    agentFirm: firmFromAddress(address, name),
    agentEmail: email,
    agentPhone: phone,
    source: "Council planning register (Idox contacts tab)",
  };
}

/**
 * Pull the agent's details from whatever portal this application lives on.
 * Returns null when the platform isn't supported or the page names no agent —
 * the caller then falls back to the AI researcher.
 */
export async function extractContactFromPortal(
  councilUrl: string | null | undefined
): Promise<PortalContact | null> {
  const url = councilUrl?.trim();
  if (!url) return null;

  const idoxUrl = idoxContactsUrl(url);
  if (idoxUrl) {
    const html = await fetchHtml(idoxUrl);
    return html ? parseIdox(html) : null;
  }

  // Other platforms (Ocella, Northgate, NECSWS, Agile APAS, Salesforce) render
  // contacts differently or behind JavaScript; they stay on the AI path until
  // each is verified individually.
  return null;
}

/** True when this lead sits on a platform we can read directly. */
export function isSupportedPortal(councilUrl: string | null | undefined): boolean {
  return !!councilUrl && idoxContactsUrl(councilUrl) !== null;
}
