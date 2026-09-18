// Reading the agent straight off the council's planning register.
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
// with no model in the loop to invent anything.
//
// Not every council fills that tab. Kingston, Guildford and Reigate leave it empty
// and put the agent on the "Further Information" tab instead (name, practice and
// address, no email); Wandsworth's Northgate register and Hammersmith & Fulham's
// NECSWS register print the agent's practice on the application page. A practice
// name is still worth having — it is exactly what the web researcher needs to
// find the firm's inbox — so those are read too and handed on as a partial
// contact.
//
// This is public register data that councils publish precisely so people can see
// who is developing what. It is still someone's personal email, so: one request
// per application, a real User-Agent, a pause between requests, and no bulk
// harvesting beyond the leads actually being worked.

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The register is refusing us for now (429, or 503 under load). This is not "no
 * agent on the page": Kingston rate-limited a batch on 17 Sep 2026 and every
 * refused lead was filed as not_found and never tried again, though the agent
 * was sitting on the page. Callers leave the lead for a later run instead.
 */
export class PortalBusyError extends Error {
  constructor(readonly status: number) {
    super(`Council register busy (HTTP ${status})`);
  }
}

const isBusy = (status: number) => status === 429 || status === 503;

async function fetchHtml(url: string): Promise<string | null> {
  let res: Response;
  try {
    // One more try for a 503 hiccup; a 429 is not retried here, because hitting a
    // register that has just asked us to slow down only prolongs the block.
    res = await withRetry(async () => {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(25000),
      });
      if (r.status === 503) throw new PortalBusyError(r.status);
      return r;
    }, 1);
  } catch (error) {
    if (error instanceof PortalBusyError) throw error;
    return null;
  }
  if (isBusy(res.status)) throw new PortalBusyError(res.status);
  if (!res.ok) return null;
  return res.text().catch(() => null);
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
 * Tanner", "Saroop Saroop Hanspal", "PETER Peter Munnelly", "T Tom Manwell". Left alone the letter
 * would open "Dear Mr," — the greeting takes the first word — so the title goes
 * and consecutive repeats collapse, keeping the better-capitalised copy.
 */
export function cleanAgentName(raw: string | null): string | null {
  if (!raw) return null;
  let words = raw.trim().split(/\s+/);
  words = words.filter((w, i) => !(i === 0 && /^(mr|mrs|ms|miss|dr|prof|sir|rev)\.?$/i.test(w)));
  // "T Tom Manwell" — an initial stored ahead of the forename it abbreviates.
  if (words.length > 2 && /^[a-z]\.?$/i.test(words[0]) && words[1][0]?.toLowerCase() === words[0][0].toLowerCase()) {
    words = words.slice(1);
  }
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

// Words that only ever end a practice's name. A registered suffix is required
// before anything is read as a firm: "Flat 14 Clive House" and "The Grange" once
// went into letters as the agent's company because a looser rule guessed.
const FIRM_SUFFIX =
  /^(.{2,80}?\b(?:ltd|limited|llp|plc|architects?|architecture|planning|associates|consultants?|consultancy|partnership|surveyors))\b\.?/i;

/** A practice name, when the text plainly starts with one. */
export function firmFromText(text: string | null): string | null {
  const value = text?.trim();
  if (!value || /^\d/.test(value) || /^(flat|unit|apartment|suite|floor)\b/i.test(value)) return null;
  const firm = value.match(FIRM_SUFFIX)?.[1]?.trim();
  return firm && firm.split(/\s+/).length <= 8 ? firm : null;
}

/** A name that is really a practice ("Whiteman Architects"), not a person. */
function looksLikeFirm(name: string | null): boolean {
  return !!name && firmFromText(name) === name;
}

// ---------------------------------------------------------------------------
// Idox Public Access
// ---------------------------------------------------------------------------

function isIdoxUrl(url: string): boolean {
  return /online-applications\/applicationDetails\.do/i.test(url);
}

function idoxTabUrl(councilUrl: string, tab: "contacts" | "details"): string | null {
  if (!isIdoxUrl(councilUrl)) return null;
  const url = councilUrl.replace(/([?&])activeTab=[^&]*/gi, `$1activeTab=${tab}`);
  return new RegExp(`activeTab=${tab}`, "i").test(url)
    ? url
    : `${url}${url.includes("?") ? "&" : "?"}activeTab=${tab}`;
}

/** Idox Public Access. The application page carries the contacts under `?activeTab=contacts`. */
export function idoxContactsUrl(councilUrl: string): string | null {
  return idoxTabUrl(councilUrl, "contacts");
}

/** Every `<th>label</th><td>value</td>` pair, lower-cased label -> decoded value. */
function tableFields(html: string): Map<string, string> {
  const fields = new Map<string, string>();
  // `<td/>` is how Idox writes an empty cell; without this alternative the match
  // runs on into the next row and files the address under the company name.
  const rows = /<th[^>]*>([\s\S]*?)<\/th>\s*(?:<td[^>]*\/>|<td[^>]*>([\s\S]*?)<\/td>)/gi;
  for (const row of html.matchAll(rows)) {
    const key = decode(row[1]).toLowerCase();
    const value = decode(row[2] ?? "");
    if (key && value && !fields.has(key)) fields.set(key, value);
  }
  return fields;
}

function pickField(fields: Map<string, string>, ...keys: string[]): string | null {
  for (const k of keys) {
    for (const [key, value] of fields) if (key.includes(k)) return value;
  }
  return null;
}

function parseIdoxContacts(html: string): PortalContact | null {
  // The agent block, up to the next sibling section (applicants / councillors).
  const block = html.match(/<div class="agents">([\s\S]*?)<\/div>/i)?.[1];
  if (!block) return null;

  const name = cleanAgentName(decode(block.match(/<h3>\s*Agent\s*<\/h3>\s*<p>([\s\S]*?)<\/p>/i)?.[1] ?? "") || null);
  const fields = tableFields(block);

  // Company details before personal ones — a practice inbox survives the
  // individual moving on, and is the more appropriate address to write to.
  const { email } = usableEmail(pickField(fields, "company email", "email"));
  const phone = pickField(fields, "company phone", "phone", "mobile", "telephone");
  if (!name && !email && !phone) return null;

  const firm = looksLikeFirm(name) ? name : firmFromText(pickField(fields, "company", "address"));
  return {
    agentName: looksLikeFirm(name) ? null : name,
    agentFirm: firm,
    agentEmail: email,
    agentPhone: phone,
    source: "Council planning register (contacts tab)",
  };
}

function parseIdoxDetails(html: string): PortalContact | null {
  const fields = tableFields(html);
  const rawName = pickField(fields, "agent name");
  const company = pickField(fields, "agent company");
  const address = pickField(fields, "agent address");
  const phone = pickField(fields, "agent phone", "agent telephone");
  const { email } = usableEmail(pickField(fields, "agent email"));

  // Reigate files the practice under "Agent Name"; Kingston puts it at the start
  // of the address. Either way the person and the practice end up apart.
  const name = looksLikeFirm(rawName) ? null : cleanAgentName(rawName);
  const firm = firmFromText(company) ?? company ?? (looksLikeFirm(rawName) ? rawName : firmFromText(address));
  if (!name && !firm && !email && !phone) return null;

  return {
    agentName: name,
    agentFirm: firm,
    agentEmail: email,
    agentPhone: phone,
    source: "Council planning register (further information tab)",
  };
}

// ---------------------------------------------------------------------------
// Northgate Planning Explorer (Wandsworth) — `<span>Agent</span>Hedley Clark Ltd`
// ---------------------------------------------------------------------------

function isNorthgateUrl(url: string): boolean {
  return /\/PlanningExplorer\//i.test(url);
}

function parseNorthgate(html: string): PortalContact | null {
  const raw = html.match(/<span>\s*Agent\s*<\/span>([\s\S]*?)<\/div>/i)?.[1];
  const value = raw ? decode(raw) : "";
  if (!value) return null;
  const firm = looksLikeFirm(value) ? value : firmFromText(value);
  return {
    agentName: firm ? null : cleanAgentName(value),
    agentFirm: firm,
    agentEmail: null,
    agentPhone: null,
    source: "Council planning register (application details)",
  };
}

// ---------------------------------------------------------------------------
// NECSWS (Hammersmith & Fulham) — `<label>Agent/Company</label> … Mr Alfie Blagg / Savills`
// ---------------------------------------------------------------------------

function isNecswsUrl(url: string): boolean {
  return /\/NECSWS\//i.test(url);
}

function parseNecsws(html: string): PortalContact | null {
  const raw = html.match(/<label>\s*Agent\s*\/\s*Company\s*<\/label>[\s\S]*?<label[^>]*>([\s\S]*?)<\/label>/i)?.[1];
  const value = raw ? decode(raw) : "";
  if (!value) return null;
  const [person, company] = value.split(/\s+\/\s+/);
  const name = cleanAgentName(person?.trim() || null);
  const firm = company?.trim() || (looksLikeFirm(name) ? name : null);
  return {
    agentName: firm === name ? null : name,
    agentFirm: firm || null,
    agentEmail: null,
    agentPhone: null,
    source: "Council planning register (application overview)",
  };
}

// ---------------------------------------------------------------------------

/** Two partial reads of the same application, the first one winning where both have a value. */
function mergeContacts(primary: PortalContact | null, secondary: PortalContact | null): PortalContact | null {
  if (!primary) return secondary;
  if (!secondary) return primary;
  return {
    agentName: primary.agentName ?? secondary.agentName,
    agentFirm: primary.agentFirm ?? secondary.agentFirm,
    agentEmail: primary.agentEmail ?? secondary.agentEmail,
    agentPhone: primary.agentPhone ?? secondary.agentPhone,
    source: primary.agentEmail ? primary.source : `${primary.source}; ${secondary.source}`,
  };
}

/**
 * Pull the agent's details from whatever portal this application lives on.
 * Returns null when the platform isn't supported or the page names no agent —
 * the caller then falls back to the AI researcher. A result without an email is
 * a partial contact: the caller should hand its name and practice to the
 * researcher to find the inbox. Throws PortalBusyError when the register is
 * refusing requests, so the caller can try again later rather than give up.
 */
export async function extractContactFromPortal(
  councilUrl: string | null | undefined
): Promise<PortalContact | null> {
  const url = councilUrl?.trim();
  if (!url) return null;

  if (isIdoxUrl(url)) {
    const contactsHtml = await fetchHtml(idoxTabUrl(url, "contacts")!);
    const contacts = contactsHtml ? parseIdoxContacts(contactsHtml) : null;
    if (contacts?.agentEmail && (contacts.agentFirm || contacts.agentName)) return contacts;

    await sleep(PORTAL_REQUEST_DELAY_MS);
    const detailsHtml = await fetchHtml(idoxTabUrl(url, "details")!);
    return mergeContacts(contacts, detailsHtml ? parseIdoxDetails(detailsHtml) : null);
  }

  if (isNorthgateUrl(url)) {
    const html = await fetchHtml(url);
    return html ? parseNorthgate(html) : null;
  }

  if (isNecswsUrl(url)) {
    const html = await fetchHtml(url);
    return html ? parseNecsws(html) : null;
  }

  // Other platforms (Merton's bot-challenged register, Elmbridge's map portal,
  // Mole Valley's horizoNext) render contacts behind JavaScript or a challenge;
  // they stay on the AI path.
  return null;
}

/** True when this lead sits on a platform we can read directly. */
export function isSupportedPortal(councilUrl: string | null | undefined): boolean {
  return !!councilUrl && (isIdoxUrl(councilUrl) || isNorthgateUrl(councilUrl) || isNecswsUrl(councilUrl));
}

/**
 * Idox registers whose search accepts a council reference. Lambeth publishes no
 * application links in the London feed at all, so without this its leads never
 * reach the register reader. Verified against the live portals.
 */
const IDOX_SEARCH_HOSTS: Record<string, string> = {
  lambeth: "planning.lambeth.gov.uk",
  kingston: "publicaccess.kingston.gov.uk",
  lewisham: "planning.lewisham.gov.uk",
  guildford: "publicaccess.guildford.gov.uk",
  reigateandbanstead: "planning.reigate-banstead.gov.uk",
  epsomandewell: "eplanning.epsom-ewell.gov.uk",
};

function councilSearchKey(council: string): string {
  return council.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}

/**
 * Turn a council reference into the application's page on an Idox register.
 *
 * Idox only runs a search as a POST from its own form, carrying the session
 * cookie and CSRF token that the form page issued, so this loads the form first
 * and submits it the way a browser would. One exact reference gives one result,
 * which Idox either redirects to or lists once.
 */
export async function resolveIdoxApplicationUrl(council: string, reference: string | null): Promise<string | null> {
  const host = IDOX_SEARCH_HOSTS[councilSearchKey(council)];
  if (!host || !reference?.trim()) return null;

  try {
    const formUrl = `https://${host}/online-applications/search.do?action=simple&searchType=Application`;
    const form = await fetch(formUrl, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(25000),
    });
    if (!form.ok) return null;
    const formHtml = await form.text();
    const csrf = formHtml.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
    const cookie = form.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");

    await sleep(PORTAL_REQUEST_DELAY_MS);
    const body = new URLSearchParams({
      ...(csrf ? { _csrf: csrf } : {}),
      "searchCriteria.simpleSearchString": reference.trim(),
      searchType: "Application",
      "searchCriteria.simpleSearch": "true",
      action: "firstPage",
    });
    const res = await fetch(`https://${host}/online-applications/simpleSearchResults.do?action=firstPage`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: formUrl,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body,
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return null;

    const keyFromUrl = res.url.match(/keyVal=([A-Za-z0-9_]+)/)?.[1];
    const html = keyFromUrl ? "" : await res.text();
    const keys = [...new Set([...html.matchAll(/keyVal=([A-Za-z0-9_]+)/g)].map((m) => m[1]))];
    // More than one distinct application means the reference wasn't exact; a
    // guess here would put the wrong agent on the lead.
    const keyVal = keyFromUrl ?? (keys.length === 1 ? keys[0] : null);
    return keyVal
      ? `https://${host}/online-applications/applicationDetails.do?activeTab=summary&keyVal=${keyVal}`
      : null;
  } catch {
    return null;
  }
}
