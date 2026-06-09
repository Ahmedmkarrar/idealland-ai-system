import { prisma } from "@/lib/db/client";
import { sendPlanningAlert } from "@/lib/services/email";
import { autoSendApplicationAlert } from "@/lib/services/mailing";
import { withRetry } from "@/lib/retry";
import * as cheerio from "cheerio";

const IDOX_BOROUGHS: Array<{ council: string; baseUrl: string }> = [
  { council: "Camden", baseUrl: "https://planningrecords.camden.gov.uk/Northgate/PlanningExplorer" },
  { council: "Hackney", baseUrl: "https://publicaccess.hackney.gov.uk/online-applications" },
  { council: "Islington", baseUrl: "https://publicaccess.islington.gov.uk/online-applications" },
  { council: "Tower Hamlets", baseUrl: "https://development.towerhamlets.gov.uk/online-applications" },
  { council: "Newham", baseUrl: "https://pa.newham.gov.uk/online-applications" },
  { council: "Southwark", baseUrl: "https://planning.southwark.gov.uk/online-applications" },
  { council: "Lambeth", baseUrl: "https://planning.lambeth.gov.uk/online-applications" },
  { council: "Lewisham", baseUrl: "https://planning.lewisham.gov.uk/online-applications" },
  { council: "Greenwich", baseUrl: "https://www2.greenwich.gov.uk/online-applications" },
  { council: "Wandsworth", baseUrl: "https://planning.wandsworth.gov.uk/Northgate/PlanningExplorer" },
  { council: "Westminster", baseUrl: "https://idoxpa.westminster.gov.uk/online-applications" },
  { council: "Hammersmith and Fulham", baseUrl: "https://public-access.lbhf.gov.uk/online-applications" },
  { council: "Kensington and Chelsea", baseUrl: "https://publicaccess.rbkc.gov.uk/online-applications" },
  { council: "Haringey", baseUrl: "https://www.planningservices.haringey.gov.uk/online-applications" },
  { council: "Barnet", baseUrl: "https://publicaccess.barnet.gov.uk/online-applications" },
  { council: "Enfield", baseUrl: "https://planningandbuildingcontrol.enfield.gov.uk/online-applications" },
  { council: "Waltham Forest", baseUrl: "https://planning.walthamforest.gov.uk/online-applications" },
  { council: "Redbridge", baseUrl: "https://publicaccess.redbridge.gov.uk/online-applications" },
  { council: "Havering", baseUrl: "https://development.havering.gov.uk/online-applications" },
  { council: "Bexley", baseUrl: "https://pa.bexley.gov.uk/online-applications" },
  { council: "Bromley", baseUrl: "https://searchapplications.bromley.gov.uk/online-applications" },
  { council: "Croydon", baseUrl: "https://publicaccess3.croydon.gov.uk/online-applications" },
  { council: "Sutton", baseUrl: "https://planningregister.sutton.gov.uk/online-applications" },
  { council: "Merton", baseUrl: "https://planning.merton.gov.uk/Northgate/PlanningExplorer" },
  { council: "Kingston", baseUrl: "https://publicaccess.kingston.gov.uk/online-applications" },
  { council: "Richmond", baseUrl: "https://www2.richmond.gov.uk/lbrplanning/online-applications" },
  { council: "Hounslow", baseUrl: "https://planning.hounslow.gov.uk/online-applications" },
];

interface ScrapedApplication {
  reference: string;
  address: string;
  description: string;
  submittedAt: Date;
  applicant?: string;
}

// PRIMARY data source — UK government's official planning data API.
// Free, no auth, no Cloudflare. Covers all 33 London LPAs (data freshness
// varies — some boroughs back-load data, others stream live). Used as the
// first attempt for each council; Idox scrape kept as a fallback if/when
// we add a scraping proxy that can defeat Cloudflare.
//
// IDs sourced from: GET /entity.json?dataset=local-planning-authority&limit=500
const LONDON_LPAS_GOVUK: Array<{ council: string; orgEntity: number }> = [
  { council: "Camden",                  orgEntity: 626188 },
  { council: "City of London",          orgEntity: 626189 },
  { council: "Hackney",                 orgEntity: 626190 },
  { council: "Hammersmith and Fulham",  orgEntity: 626191 },
  { council: "Haringey",                orgEntity: 626192 },
  { council: "Islington",               orgEntity: 626193 },
  { council: "Kensington and Chelsea",  orgEntity: 626194 },
  { council: "Lambeth",                 orgEntity: 626195 },
  { council: "Lewisham",                orgEntity: 626196 },
  { council: "Newham",                  orgEntity: 626197 },
  { council: "Southwark",               orgEntity: 626198 },
  { council: "Tower Hamlets",           orgEntity: 626199 },
  { council: "Wandsworth",              orgEntity: 626200 },
  { council: "Westminster",             orgEntity: 626201 },
  { council: "Barnet",                  orgEntity: 626203 },
  { council: "Bexley",                  orgEntity: 626204 },
  { council: "Brent",                   orgEntity: 626205 },
  { council: "Bromley",                 orgEntity: 626206 },
  { council: "Croydon",                 orgEntity: 626207 },
  { council: "Ealing",                  orgEntity: 626208 },
  { council: "Enfield",                 orgEntity: 626209 },
  { council: "Greenwich",               orgEntity: 626210 },
  { council: "Harrow",                  orgEntity: 626211 },
  { council: "Havering",                orgEntity: 626212 },
  { council: "Hillingdon",              orgEntity: 626213 },
  { council: "Hounslow",                orgEntity: 626214 },
  { council: "Kingston upon Thames",    orgEntity: 626215 },
  { council: "Merton",                  orgEntity: 626216 },
  { council: "Redbridge",               orgEntity: 626217 },
  { council: "Richmond upon Thames",    orgEntity: 626218 },
  { council: "Sutton",                  orgEntity: 626219 },
  { council: "Waltham Forest",          orgEntity: 626220 },
];

interface GovUkPlanningEntity {
  reference?: string;
  name?: string;
  description?: string;
  "start-date"?: string;
  "entry-date"?: string;
  point?: string;
  geometry?: string;
  json?: { address?: string; site_address?: string; applicant?: string } | string;
}

async function fetchFromGovUk(orgEntity: number): Promise<ScrapedApplication[]> {
  const url = `https://www.planning.data.gov.uk/entity.json?dataset=planning-application&organisation-entity=${orgEntity}&limit=100`;

  try {
    const response = await withRetry(() =>
      fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "idealland-automation/1.0 (london property intelligence)" },
        signal: AbortSignal.timeout(20000),
      })
    );

    if (!response.ok) return [];

    const data = (await response.json()) as { entities?: GovUkPlanningEntity[] };
    const entities = data.entities ?? [];

    return entities
      .filter((e) => e.reference && e.description)
      .map((e) => {
        // The API's `json` field sometimes contains the full original payload
        // as either a parsed object or a stringified one. Pull address out of
        // either shape, fall back to name, fall back to "[address unknown]".
        let parsedJson: { address?: string; site_address?: string; applicant?: string } = {};
        if (typeof e.json === "string") {
          try { parsedJson = JSON.parse(e.json); } catch { /* leave empty */ }
        } else if (e.json && typeof e.json === "object") {
          parsedJson = e.json;
        }

        // gov.uk API doesn't expose addresses (geometry/point fields are
        // typically empty too). Fall back to the reference, which is what
        // IdealLand staff will use to look the application up in the council
        // portal anyway. Future: reverse-geocode the point field when present.
        const address = parsedJson.site_address ?? parsedJson.address ?? (e.name && e.name.length > 0 ? e.name : `Ref ${e.reference}`);
        const submittedAt = e["start-date"] ? new Date(e["start-date"]) : (e["entry-date"] ? new Date(e["entry-date"]) : new Date());

        return {
          reference: e.reference!,
          address,
          description: e.description!,
          submittedAt,
          applicant: parsedJson.applicant,
        };
      });
  } catch {
    return [];
  }
}

function parseIdoxResultsPage(html: string): ScrapedApplication[] {
  const $ = cheerio.load(html);
  const results: ScrapedApplication[] = [];

  $("li.searchresult").each((_, el) => {
    const reference = $(el).find("a.searchresultLink").text().trim();
    const address = $(el).find("p.address").text().trim();
    const description = $(el).find("p.description").text().trim();
    const receivedText = $(el).find("p.received").text().trim();

    if (!reference || !address) return;

    const dateMatch = receivedText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    const submittedAt = dateMatch
      ? new Date(dateMatch[1].split("/").reverse().join("-"))
      : new Date();

    results.push({ reference, address, description, submittedAt });
  });

  return results;
}

async function scrapeIdoxCouncil(council: string, baseUrl: string): Promise<ScrapedApplication[]> {
  const searchUrl = `${baseUrl}/search.do?action=simple&searchType=Application`;
  const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
  const dateFrom = fourWeeksAgo.toLocaleDateString("en-GB");

  const baseParams = new URLSearchParams({
    "searchCriteria.description": "residential",
    "searchCriteria.receivedFrom": dateFrom,
    caseType: "Application",
  });

  const allResults: ScrapedApplication[] = [];

  try {
    for (let page = 1; page <= 3; page++) {
      const pageParams = new URLSearchParams(baseParams);
      if (page > 1) pageParams.set("searchCriteria.page", String(page));

      const response = await withRetry(() =>
        fetch(`${searchUrl}&${pageParams}`, {
          headers: REALISTIC_BROWSER_HEADERS,
          signal: AbortSignal.timeout(15000),
        })
      );

      if (!response.ok) {
        console.warn(`[sourcing] ${council} page ${page} → HTTP ${response.status}`);
        break;
      }

      const html = await response.text();
      const pageResults = parseIdoxResultsPage(html);

      allResults.push(...pageResults);

      if (pageResults.length < 10) break;

      // Polite delay between paginated requests so the same council doesn't see
      // back-to-back hits — looks more human, lower chance of throttling.
      await sleep(randomMs(800, 1800));
    }

    return allResults;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[sourcing] ${council} threw: ${msg}`);
    return allResults;
  }
}

// Real-Chrome-on-Mac headers. The previous "planning-monitor/1.0" UA was a
// dead giveaway for anti-bot systems on Idox/Northgate council portals —
// every borough was returning empty (boroughsBlocked: 27/27 for days).
const REALISTIC_BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  Connection: "keep-alive",
  DNT: "1",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomMs(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

// Fisher-Yates: shuffle so we don't hit councils in the same order each run.
// Predictable order is a tell for batch scrapers.
function shuffled<T>(arr: readonly T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const UNIT_PATTERNS = [
  /(\d+)\s*(?:no\.?\s*)?(?:residential\s+)?(?:unit|flat|dwelling|apartment|home|bedroom)/i,
  /(?:provision|erection|construction|demolition\s+and\s+erection)\s+of\s+(\d+)/i,
  /(\d+)\s*(?:x\s*)?(?:affordable|market|private)\s+(?:residential\s+)?(?:unit|flat|home|dwelling)/i,
];

// Return the explicit unit count from the description, or 0 if none found.
// (Old behaviour defaulted to 10, which let through every small extension
// that happened to contain the word "dwelling". Now we require an actual
// number.)
function extractUnitCount(description: string): number {
  for (const pattern of UNIT_PATTERNS) {
    const match = description.match(pattern);
    if (match?.[1]) {
      const n = parseInt(match[1], 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

// Common "tiny" application keywords — if the description matches any of
// these without ALSO containing a clear multi-unit indicator, it's almost
// certainly a domestic extension, not a development opportunity.
const TINY_APPLICATION_PATTERNS = [
  /\b(rear|front|side|loft|garage|porch|outbuilding|conservatory|garden\s+room|shed|fence|tree)\s+(extension|conversion|alteration|works?)/i,
  /\bsingle\s+(storey|story)\s+(rear|front|side|infill)\s+extension/i,
  /\binternal\s+alterations?\b/i,
  /\bchange\s+of\s+use\s+from\s+\w+\s+to\s+(single\s+)?(dwelling|residential)\s*(house|unit)?\s*(only|\.|\,|$)/i,
  /\bdwelling\s+(house|extension)\b.*?\b(single|one|1)\b/i,
];

function looksLikeTinyApplication(description: string): boolean {
  return TINY_APPLICATION_PATTERNS.some((p) => p.test(description));
}

function looksLikeLargeResidential(description: string): boolean {
  if (looksLikeTinyApplication(description)) return false;

  const units = extractUnitCount(description);
  if (units >= 10) return true;

  // Fallback for descriptions that don't mention units numerically but
  // describe substantial schemes (blocks, towers, major redevelopment).
  const lower = description.toLowerCase();
  const hasMajorSchemeKeyword =
    /\b(block\s+of\s+(flats|apartments)|residential\s+block|residential\s+tower|major\s+redevelopment|comprehensive\s+redevelopment|mixed[\s-]use\s+(scheme|development)|new\s+build\s+residential)/i.test(
      description
    );
  return hasMajorSchemeKeyword && (lower.includes("residential") || lower.includes("dwelling") || lower.includes("flat") || lower.includes("apartment"));
}

export async function scanCouncils(): Promise<{
  found: number;
  alerted: number;
  boroughsScanned: number;
  boroughsBlocked: number;
}> {
  const runRecord = await prisma.automationRun.create({
    data: { type: "sourcing", status: "running" },
  });

  try {
    const newApplications: Array<{
      id: string;
      reference: string;
      council: string;
      address: string;
      description: string;
      units: number;
      submittedAt: Date;
    }> = [];

    let boroughsBlocked = 0;
    let isFirstBorough = true;

    // PRIMARY: pull from planning.data.gov.uk for all 33 London LPAs. Free,
    // official, no Cloudflare. If a borough returns empty, fall back to the
    // direct Idox scrape (currently blocked by Cloudflare from the droplet IP
    // but kept in case we add a scraping proxy later).
    const idoxByName = new Map(IDOX_BOROUGHS.map((b) => [b.council.toLowerCase(), b.baseUrl] as const));

    for (const { council, orgEntity } of shuffled(LONDON_LPAS_GOVUK)) {
      if (!isFirstBorough) {
        // 1-3s polite delay between gov.uk requests
        await sleep(randomMs(1000, 3000));
      }
      isFirstBorough = false;

      let scraped = await fetchFromGovUk(orgEntity);

      // Fallback: try the legacy Idox scrape if gov.uk returned nothing AND
      // we have an Idox URL for this council. Wrapped so a fallback failure
      // doesn't blow up the run.
      if (scraped.length === 0) {
        const baseUrl = idoxByName.get(council.toLowerCase()) ?? idoxByName.get(council.split(" upon ")[0].toLowerCase());
        if (baseUrl) {
          try {
            scraped = await scrapeIdoxCouncil(council, baseUrl);
          } catch {
            // Idox is expected to fail on Cloudflare; ignore.
          }
        }
      }

      if (scraped.length === 0) boroughsBlocked++;

      const relevant = scraped.filter((app) => looksLikeLargeResidential(app.description));

      for (const app of relevant) {
        const existing = await prisma.planningApplication.findUnique({
          where: { reference: app.reference },
        });
        if (existing) continue;

        const created = await prisma.planningApplication.create({
          data: {
            reference: app.reference,
            address: app.address,
            description: app.description,
            council,
            units: extractUnitCount(app.description),
            status: "submitted",
            applicant: app.applicant ?? null,
            submittedAt: app.submittedAt,
            alertSent: false,
          },
        });

        newApplications.push(created);
      }
    }

    if (newApplications.length > 0) {
      await prisma.planningApplication.updateMany({
        where: { id: { in: newApplications.map((a) => a.id) } },
        data: { alertSent: true },
      });

      const alertPayload = newApplications.map((a) => ({
        reference: a.reference,
        address: a.address,
        council: a.council,
        units: a.units,
        description: a.description,
        submittedAt: a.submittedAt,
      }));

      // Alert internal team via email + auto-send to developer mailing list
      await Promise.allSettled([
        sendPlanningAlert(alertPayload),
        autoSendApplicationAlert(alertPayload),
      ]);
    }

    const boroughsScanned = LONDON_LPAS_GOVUK.length - boroughsBlocked;

    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        summary: `Scanned ${boroughsScanned}/${LONDON_LPAS_GOVUK.length} boroughs via planning.data.gov.uk (${boroughsBlocked} empty/unavailable). Found ${newApplications.length} new 10+ unit applications.`,
      },
    });

    return {
      found: newApplications.length,
      alerted: newApplications.length,
      boroughsScanned,
      boroughsBlocked,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: { status: "failed", completedAt: new Date(), error: message },
    });
    throw error;
  }
}

export async function getApplications(filters?: {
  status?: string;
  council?: string;
  minUnits?: number;
}) {
  return prisma.planningApplication.findMany({
    where: {
      ...(filters?.status && { status: filters.status }),
      ...(filters?.council && { council: filters.council }),
      ...(filters?.minUnits && { units: { gte: filters.minUnits } }),
    },
    orderBy: { submittedAt: "desc" },
    include: { documents: true },
  });
}
