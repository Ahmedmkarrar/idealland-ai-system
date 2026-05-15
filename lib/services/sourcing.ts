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

async function scrapeIdoxCouncil(_council: string, baseUrl: string): Promise<ScrapedApplication[]> {
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
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; planning-monitor/1.0)",
            Accept: "text/html,application/xhtml+xml",
          },
          signal: AbortSignal.timeout(10000),
        })
      );

      if (!response.ok) break;

      const html = await response.text();
      const pageResults = parseIdoxResultsPage(html);

      allResults.push(...pageResults);

      if (pageResults.length < 10) break;
    }

    return allResults;
  } catch {
    return allResults;
  }
}

const UNIT_PATTERNS = [
  /(\d+)\s*(?:no\.?\s*)?(?:residential\s+)?(?:unit|flat|dwelling|apartment|home|bedroom)/i,
  /(?:provision|erection|construction|demolition\s+and\s+erection)\s+of\s+(\d+)/i,
  /(\d+)\s*(?:x\s*)?(?:affordable|market|private)\s+(?:residential\s+)?(?:unit|flat|home|dwelling)/i,
];

function extractUnitCount(description: string): number {
  for (const pattern of UNIT_PATTERNS) {
    const match = description.match(pattern);
    if (match?.[1]) return parseInt(match[1], 10);
  }
  return 10;
}

function looksLikeLargeResidential(description: string): boolean {
  const lower = description.toLowerCase();
  const hasResidentialWord = ["residential", "dwelling", "flat", "apartment", "unit", "home"].some(
    (w) => lower.includes(w)
  );
  if (!hasResidentialWord) return false;
  return extractUnitCount(description) >= 10;
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

    for (const { council, baseUrl } of IDOX_BOROUGHS) {
      const scraped = await scrapeIdoxCouncil(council, baseUrl);
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

    const boroughsScanned = IDOX_BOROUGHS.length - boroughsBlocked;

    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        summary: `Scanned ${boroughsScanned}/${IDOX_BOROUGHS.length} boroughs (${boroughsBlocked} blocked/unavailable). Found ${newApplications.length} new 10+ unit applications.`,
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
