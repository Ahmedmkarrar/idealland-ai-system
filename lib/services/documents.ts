import { prisma } from "@/lib/db/client";
import { withRetry } from "@/lib/retry";
import { IDOX_COUNCIL_DOMAIN_MAP } from "@/lib/constants/councils";

const HMLR_API_BASE = "https://use-land-property-data.service.gov.uk/api/v1";

function isHmlrConfigured(): boolean {
  const key = process.env.HMLR_API_KEY;
  return !!(key && !key.includes("PLACEHOLDER"));
}

async function fetchLandRegistryTitle(
  address: string
): Promise<{ url: string; fileSize: string } | null> {
  if (!isHmlrConfigured()) return null;

  try {
    const params = new URLSearchParams({ query: address, limit: "1" });
    const response = await withRetry(() =>
      fetch(`${HMLR_API_BASE}/properties?${params}`, {
        headers: {
          Authorization: `Bearer ${process.env.HMLR_API_KEY}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
      })
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      properties?: Array<{ title_number?: string }>;
    };
    const titleNumber = data.properties?.[0]?.title_number;
    if (!titleNumber) return null;

    const titleResponse = await withRetry(() =>
      fetch(`${HMLR_API_BASE}/titles/${titleNumber}/register`, {
        headers: {
          Authorization: `Bearer ${process.env.HMLR_API_KEY}`,
          Accept: "application/pdf",
        },
        signal: AbortSignal.timeout(8000),
      })
    );

    if (!titleResponse.ok) return null;

    const contentLength = titleResponse.headers.get("content-length");
    return {
      url: `${HMLR_API_BASE}/titles/${titleNumber}/register`,
      fileSize: contentLength
        ? `${Math.floor(parseInt(contentLength, 10) / 1024)}KB`
        : "unknown",
    };
  } catch {
    return null;
  }
}

const COUNCIL_DOMAIN_MAP = IDOX_COUNCIL_DOMAIN_MAP;

const DAS_KEYWORDS = ["design and access", "design & access", "das", "design access statement"];

async function fetchDasFromCouncil(
  council: string,
  reference: string
): Promise<{ url: string; fileSize: string } | null> {
  const domain = COUNCIL_DOMAIN_MAP[council];
  if (!domain) return null;

  try {
    const documentListUrl = `https://${domain}/online-applications/applicationDetails.do?keyVal=${encodeURIComponent(reference)}&activeTab=documents`;
    const response = await withRetry(() =>
      fetch(documentListUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; planning-monitor/1.0)" },
        signal: AbortSignal.timeout(8000),
      })
    );

    if (!response.ok) return null;

    const html = await response.text();
    const { load } = await import("cheerio");
    const $ = load(html);

    // Find the DAS document link by matching anchor text against known keywords
    let dasUrl: string | null = null;
    $("a[href]").each((_, el) => {
      if (dasUrl) return;
      const linkText = $(el).text().trim().toLowerCase();
      const isDas = DAS_KEYWORDS.some((kw) => linkText.includes(kw));
      if (!isDas) return;

      const href = $(el).attr("href") ?? "";
      dasUrl = href.startsWith("http") ? href : `https://${domain}${href.startsWith("/") ? "" : "/"}${href}`;
    });

    if (dasUrl) return { url: dasUrl, fileSize: "varies" };

    // Fallback: return the documents page URL so the user can navigate there
    return { url: documentListUrl, fileSize: "varies" };
  } catch {
    return null;
  }
}

export async function retrieveDocuments(
  applicationId: string
): Promise<{ retrieved: number; failed: number }> {
  const application = await prisma.planningApplication.findUnique({
    where: { id: applicationId },
  });
  if (!application) throw new Error(`Application ${applicationId} not found`);

  const retrievedDocs = await prisma.document.count({ where: { applicationId, status: "retrieved" } });
  if (retrievedDocs > 0) return { retrieved: 0, failed: 0 };

  await prisma.document.deleteMany({ where: { applicationId, status: "pending" } });

  const [landRegistry, das] = await Promise.all([
    fetchLandRegistryTitle(application.address),
    // The council's own reference is what its document portal recognises; the
    // GLA document id means nothing there.
    fetchDasFromCouncil(application.council, application.lpaReference ?? application.reference),
  ]);

  let retrieved = 0;
  let failed = 0;

  const docs = [
    { type: "land_registry", name: "Land Registry Title Register", result: landRegistry },
    { type: "das", name: "Design & Access Statement", result: das },
  ];

  for (const doc of docs) {
    await prisma.document.create({
      data: {
        applicationId,
        type: doc.type,
        name: doc.name,
        url: doc.result?.url ?? null,
        fileSize: doc.result?.fileSize ?? null,
        status: doc.result ? "retrieved" : "pending",
        retrievedAt: doc.result ? new Date() : null,
      },
    });

    if (doc.result) retrieved++;
    else failed++;
  }

  return { retrieved, failed };
}

/**
 * Batch document retrieval.
 *
 * This used to open an AutomationRun per application — 10 per cron run, six runs
 * a day — which buried every meaningful entry in the dashboard's activity feed
 * under thousands of "Document Retrieval" lines. It now logs one run for the
 * whole batch, and only when it has something to report.
 *
 * It also no longer runs at all without an HMLR key: the only documents it can
 * fetch are Land Registry titles, so with no key every application produced two
 * permanently-pending placeholder rows and nothing else.
 */
export async function retrieveAllPendingDocuments(): Promise<{
  processed: number;
  retrieved: number;
  skipped?: string;
}> {
  if (!isHmlrConfigured()) {
    return {
      processed: 0,
      retrieved: 0,
      skipped: "HMLR_API_KEY not set — Land Registry retrieval is off",
    };
  }

  const applicationsWithoutDocs = await prisma.planningApplication.findMany({
    where: {
      OR: [
        { documents: { none: {} } },
        { documents: { every: { status: "pending" } } },
      ],
    },
    take: 10,
  });

  if (applicationsWithoutDocs.length === 0) return { processed: 0, retrieved: 0 };

  const runRecord = await prisma.automationRun.create({
    data: { type: "documents", status: "running" },
  });

  let retrieved = 0;
  try {
    for (const app of applicationsWithoutDocs) {
      const result = await retrieveDocuments(app.id);
      retrieved += result.retrieved;
    }
    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        summary: `Checked ${applicationsWithoutDocs.length} application${applicationsWithoutDocs.length === 1 ? "" : "s"} for Land Registry documents — ${retrieved} retrieved.`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: { status: "failed", completedAt: new Date(), error: message },
    });
    throw error;
  }

  return { processed: applicationsWithoutDocs.length, retrieved };
}

export async function getDocuments(applicationId?: string) {
  return prisma.document.findMany({
    where: applicationId ? { applicationId } : {},
    orderBy: { createdAt: "desc" },
    include: { application: true },
  });
}
