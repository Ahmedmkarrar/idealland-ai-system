// Reading a practice's inbox off its own website.
//
// Every letter Lucy has sent had an email address; the ones without sat in "Need
// an address" and never went (47 of them on 2 Oct 2026). Web search often finds
// the practice's website but not the address printed on it, so the site is read
// directly: the home page and the usual contact pages, mailto links and plain
// text, including Cloudflare's obfuscated addresses.
//
// Two guards keep it honest. The site must name the practice — a website left
// over from earlier research (Marrons, on a lead the register gives to JLA) is
// not the agent's. And only addresses on the site's own domain count, so a web
// designer's credit or a shared-platform address is never picked up.

import { usableEmail } from "@/lib/email-address";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const CONTACT_PATHS = ["", "/contact", "/contact-us", "/contact/", "/contact-us/", "/get-in-touch", "/about", "/about-us"];
// Practice inboxes in the order a planning consultant tends to read them.
const GENERIC_INBOXES = ["info", "enquiries", "enquiry", "hello", "office", "planning", "contact", "mail", "admin", "studio"];
const FIRM_NOISE = /\b(ltd|limited|llp|plc|the|and|&|of|planning|architects?|architecture|associates|consultants?|consultancy|design|studio|town|country|development|developments|land|partnership|group|services|property|properties|uk)\b/gi;

const FREE_MAIL = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|btinternet|aol|sky|virginmedia)\.(com|co\.uk|net)$/i;

export interface WebsiteEmail {
  email: string;
  page: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normaliseSite(website: string): URL | null {
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website.trim()}`);
    return new URL(url.origin);
  } catch {
    return null;
  }
}

const registrableDomain = (host: string) => host.toLowerCase().replace(/^www\./, "");

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    return (await res.text()).slice(0, 2_000_000);
  } catch {
    return null;
  }
}

/** Cloudflare's email protection: hex string, first byte is the XOR key. */
function decodeCloudflare(hex: string): string {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

function emailsIn(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) found.add(decodeCloudflare(m[1]));
  for (const m of html.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) found.add(decodeCloudflare(m[1]));
  const text = html.replace(/&#64;|&commat;|\s*\[at\]\s*|\s*\(at\)\s*/gi, "@").replace(/%40/g, "@");
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) found.add(m[0]);
  return [...found]
    .map((e) => e.trim().toLowerCase().replace(/^mailto:/, "").replace(/[.,;]+$/, ""))
    .filter((e) => !/\.(png|jpe?g|gif|svg|webp)$/.test(e) && !/(sentry|wixpress|example|domain\.com|email\.com)/.test(e));
}

/** The words that make a practice's name its own: "Kona" in "Kona Planning". */
function distinctiveWords(firm: string): string[] {
  return firm
    .replace(/\([^)]*\)/g, " ")
    .replace(FIRM_NOISE, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length >= 3)
    .map((w) => w.toLowerCase());
}

function namesFirm(html: string, firm: string): boolean {
  const words = distinctiveWords(firm);
  if (words.length === 0) return false;
  const text = html.replace(/<[^>]+>/g, " ").toLowerCase();
  return words.every((w) => text.includes(w));
}

function pickEmail(emails: string[], domain: string, agentName: string | null): string | null {
  const own = emails.filter((e) => {
    const d = e.split("@")[1];
    return d === domain || d.endsWith(`.${domain}`) || domain.endsWith(`.${d}`);
  });
  // Small practices often run on Gmail (NJA Town Planning prints njaltd@gmail.com
  // on its own site), so a free-mail address printed there is theirs too — but
  // only when the site gives nothing on its own domain.
  const freeMail = emails.filter((e) => FREE_MAIL.test(e.split("@")[1]));
  const usable = (own.length ? own : freeMail).filter((e) => usableEmail(e).email);
  if (usable.length === 0) return null;

  const nameParts = (agentName ?? "").toLowerCase().split(/\s+/).filter((p) => p.length > 1);
  const personal = usable.find((e) => nameParts.some((p) => e.split("@")[0].includes(p)));
  if (personal) return personal;
  for (const inbox of GENERIC_INBOXES) {
    const hit = usable.find((e) => e.split("@")[0] === inbox);
    if (hit) return hit;
  }
  return usable[0];
}

/** Websites to try when none is on file: "Pembroke Planning" -> pembrokeplanning.co.uk. */
export function guessWebsites(firm: string): string[] {
  const slug = firm
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(ltd|limited|llp|plc)\b\.?/gi, " ")
    .replace(/&/g, "and")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toLowerCase();
  if (slug.length < 4) return [];
  return [`${slug}.co.uk`, `${slug}.com`, `${slug}ltd.co.uk`];
}

/**
 * The practice's email from its own website, or null. `website` may be bare
 * ("allenplanning.co.uk"). The site must name `firm` before anything on it is
 * believed.
 */
export async function findEmailOnWebsite(
  website: string,
  firm: string,
  agentName: string | null
): Promise<WebsiteEmail | null> {
  const site = normaliseSite(website);
  if (!site) return null;
  const domain = registrableDomain(site.hostname);

  let confirmed = false;
  const collected: Array<{ email: string; page: string }> = [];
  for (const path of CONTACT_PATHS) {
    const page = `${site.origin}${path}`;
    const html = await fetchPage(page);
    if (html) {
      confirmed ||= namesFirm(html, firm);
      for (const email of emailsIn(html)) collected.push({ email, page });
    } else if (path === "") {
      return null;
    }
    // The home page alone usually settles it; stop once an own-domain address is in hand.
    if (confirmed && pickEmail(collected.map((c) => c.email), domain, agentName)) break;
    await sleep(400);
  }
  if (!confirmed) return null;

  const email = pickEmail(collected.map((c) => c.email), domain, agentName);
  return email ? { email, page: collected.find((c) => c.email === email)!.page } : null;
}
