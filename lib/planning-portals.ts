// Getting from a lead to the council's own planning-application page.
//
// The GLA feed gives us `url_planning_app` (a deep link) for roughly 70% of
// applications — but it is null for whole boroughs at a time, Croydon being the
// worst offender at ~750 leads. What the feed DOES carry for every single
// record is `lpa_app_no`, the reference the council itself uses ("26/01804/FUL").
// That reference is enough to reach the application, so this module degrades in
// three steps rather than giving up:
//
//   direct  — the council's own page for this application (one click, exact)
//   portal  — the borough's planning search with the reference already typed in
//   mirror  — a verified page on the PlanIndex planning register
//   search  — a web search for the quoted reference + borough
//
// Only hosts verified against the live portal are listed below; everything else
// falls through to `search`, which always works. Guessing a host would produce a
// dead link, which is worse than a search that lands.

export type PlanningLinkKind = "direct" | "portal" | "mirror" | "search";

export interface PlanningLink {
  url: string;
  kind: PlanningLinkKind;
  /** Button text. */
  label: string;
  /** One line telling the user what they'll get, so a search doesn't look like a bug. */
  hint: string;
}

/**
 * Boroughs whose planning portal accepts the reference as a query parameter and
 * renders its search form with the box pre-filled — verified by fetching the URL
 * and confirming `value="<ref>"` comes back in the HTML. The user clicks Search
 * once. Idox refuses to execute the search itself over GET (the results action
 * needs a session), so a pre-filled form is as close as the platform allows.
 */
const IDOX_PORTALS: Record<string, string> = {
  croydon: "publicaccess3.croydon.gov.uk",
  lambeth: "planning.lambeth.gov.uk",
  ealing: "pam.ealing.gov.uk",
};

/** "London Borough of Hammersmith & Fulham" -> "hammersmithandfulham". */
export function councilKey(council: string): string {
  return council
    .toLowerCase()
    .replace(/^(the\s+)?(london\s+borough\s+of|royal\s+borough\s+of|city\s+of)\s+/, "")
    .replace(/\b(council|borough)\b/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * PLD's `url_planning_app` is dirty: relative paths, empty strings, unfilled
 * templates ("<enter PA URL here>") and placeholder domains that councils left
 * in their feed ("http://site.com/?appref=..."). A link that goes nowhere costs
 * more trust than no link, so anything not clearly a council page is dropped.
 */
const PLACEHOLDER_HOSTS = ["site.com", "example.com", "localhost", "test.com"];

export function cleanCouncilUrl(url: string | null | undefined): string | null {
  const value = url?.trim();
  if (!value || value.includes("<") || value.includes(">")) return null;
  if (!/^https?:\/\//i.test(value)) return null;
  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (PLACEHOLDER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  return value;
}

/**
 * Recover the council's own reference from our internal id when `lpaReference`
 * hasn't been backfilled yet. Our `reference` is the PLD document id, which is
 * the council name, a hyphen, then the real reference with "/" swapped for "_"
 * ("Croydon-26_01804_FUL" -> "26/01804/FUL"). Ids that don't follow that shape
 * are returned untouched rather than mangled.
 */
export function derivedLpaReference(reference: string, council: string): string | null {
  const prefix = `${council.replace(/\s+/g, "_")}-`;
  const hasCouncilPrefix = reference.toLowerCase().startsWith(prefix.toLowerCase());
  const tail = hasCouncilPrefix ? reference.slice(prefix.length) : null;
  if (!tail) {
    // Some ids use a different prefix spelling than the council name we derived;
    // fall back to splitting on the first hyphen when the head looks like a name.
    const i = reference.indexOf("-");
    if (i <= 0) return null;
    const head = reference.slice(0, i);
    if (!/^[A-Za-z_&\s]+$/.test(head)) return null;
    return reference.slice(i + 1).replace(/_/g, "/") || null;
  }
  return tail.replace(/_/g, "/") || null;
}

/** The reference a human should type into a council portal. */
export function councilReference(app: {
  reference: string;
  council: string;
  lpaReference?: string | null;
}): string | null {
  return app.lpaReference?.trim() || derivedLpaReference(app.reference, app.council);
}

/**
 * True when the address is the "<Council> (ref <x>)" placeholder rather than a
 * real one — nothing to map, and not worth showing as if it were a location.
 */
export function hasRealAddress(address: string): boolean {
  return !/\(ref .+\)$/.test(address.trim());
}

/** Street view of the site, so the property can be looked at without leaving the row. */
export function mapUrl(address: string, council: string): string | null {
  if (!hasRealAddress(address)) return null;
  const query = /london/i.test(address) ? address : `${address}, ${council}, London`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * PlanIndex mirrors the public planning registers of 365 councils and gives each
 * application a predictable URL, which is the only way to reach a *direct* page
 * for boroughs whose own portal publishes no link (Barnet, Westminster, Bexley,
 * Southwark, Newham…).
 *
 *   26/01412/FUL + Bexley -> /planning-applications/bexley/26-01412-ful
 *
 * Coverage is per-application, not per-borough — measured at roughly 33 of 40
 * link-less leads. So this URL is never rendered on faith: it is checked once
 * when the lead is stored and only kept if the page actually exists. A link that
 * 404s a fifth of the time would be worse than the search we already have.
 */
export function planIndexUrl(council: string, reference: string): string | null {
  const slug = council.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const ref = reference.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug || !ref) return null;
  return `https://planindex.co.uk/planning-applications/${slug}/${ref}`;
}

/** Confirms a mirror page exists. Returns the URL on success, null on anything else. */
export async function verifyMirrorUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "IdealLand-Sourcing/1.0 (+https://idealland.co.uk)" },
      signal: AbortSignal.timeout(12000),
    });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

function idoxSearchUrl(host: string, reference: string): string {
  const params = new URLSearchParams({
    action: "simple",
    searchType: "Application",
    "searchCriteria.simpleSearchString": reference,
  });
  return `https://${host}/online-applications/search.do?${params}`;
}

function webSearchUrl(reference: string | null, council: string, address: string): string {
  const query = reference
    ? `"${reference}" ${council} planning application`
    : `${address} ${council} planning application`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/**
 * The best available route to this application's page on the council's site.
 * Always returns something — the caller can render one button unconditionally
 * instead of hiding it when the deep link is missing.
 */
export function planningApplicationLink(app: {
  reference: string;
  council: string;
  address: string;
  councilUrl?: string | null;
  lpaReference?: string | null;
  mirrorUrl?: string | null;
}): PlanningLink {
  const direct = cleanCouncilUrl(app.councilUrl);
  if (direct) {
    return {
      url: direct,
      kind: "direct",
      label: "View planning application",
      hint: "Opens this application on the council's planning register.",
    };
  }

  const reference = councilReference(app);
  const host = IDOX_PORTALS[councilKey(app.council)];
  if (host && reference) {
    return {
      url: idoxSearchUrl(host, reference),
      kind: "portal",
      label: "Find on council portal",
      hint: `Opens ${app.council}'s planning search with ${reference} already filled in — press Search.`,
    };
  }

  // Ranked below the council's own portal on purpose: the mirror is one click but
  // carries only the application summary, while the council's page also holds the
  // documents and the agent's name — which is what the job actually runs on.
  if (app.mirrorUrl) {
    return {
      url: app.mirrorUrl,
      kind: "mirror",
      label: "View planning application",
      hint: `${app.council} doesn't publish its own link, so this opens the application on the PlanIndex planning register.`,
    };
  }

  return {
    url: webSearchUrl(reference, app.council, app.address),
    kind: "search",
    label: "Search for application",
    hint: reference
      ? `${app.council} doesn't publish a direct link for this one — this searches the web for ${reference}.`
      : `${app.council} doesn't publish a direct link for this one — this searches the web for the address.`,
  };
}
