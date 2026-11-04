// Whether an email address can receive mail at all. Web research invented
// info@smithplanning.co.uk, and Wandsworth's register spelt Rackham Planning's
// domain "rackhamplaning.co.uk" (4 Nov 2026) — neither domain exists, so a letter
// to either bounces.

import { resolve4, resolveMx } from "node:dns/promises";

const cache = new Map<string, Promise<boolean>>();

async function lookup(domain: string): Promise<boolean> {
  const missing = (e: unknown) => ["ENOTFOUND", "ENODATA"].includes((e as NodeJS.ErrnoException).code ?? "");
  try {
    if ((await resolveMx(domain)).length > 0) return true;
  } catch (e) {
    if (!missing(e)) return true;
  }
  try {
    return (await resolve4(domain)).length > 0;
  } catch (e) {
    return !missing(e);
  }
}

/** True when the email's domain has a mail server, or an address. A DNS failure counts as yes. */
export function domainTakesMail(email: string): Promise<boolean> {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (!domain) return Promise.resolve(false);
  if (!cache.has(domain)) cache.set(domain, lookup(domain));
  return cache.get(domain)!;
}
