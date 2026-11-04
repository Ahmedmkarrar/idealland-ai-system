// Elmbridge, read straight from the council's register (Astun iShare).
//
// PlanIt stopped scraping Elmbridge on 6 Oct 2026 — its newest Elmbridge
// application is 2026/2363 (30 Sep) — so Elmbridge sent nothing for a month.
// The register's search takes a reference filter, and Elmbridge numbers its
// applications in sequence (2026/2403, 2026/2425, …), so reading the blocks of a
// hundred from just below the newest stored reference finds every new one.
//
// Each block lists number, address and proposal; schemes are shortlisted on the
// proposal (the PlanIt filter), the home count is read from it, and the agent is
// left to contact research, which already reads Elmbridge's register.

import * as cheerio from "cheerio";
import { prisma } from "@/lib/db/client";
import { looksLikeSchemeText, readNewHomes } from "@/lib/services/planit";

const COUNCIL = "Elmbridge";
const BASE = "https://emaps.elmbridge.gov.uk/ebc_planning.aspx";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MIN_UNITS = Number(process.env.PLANNING_MIN_UNITS ?? 1);
const MAX_UNITS = Number(process.env.PLANNING_MAX_UNITS ?? 9);
const RUN_TYPE = "sourcing-elmbridge";
const MIN_HOURS_BETWEEN_SCANS = 20;
const REQUEST_GAP_MS = 2500;
// Blocks of a hundred to read beyond the newest stored one; the register numbers
// roughly 70 applications a week.
const BLOCKS_AHEAD = 3;

interface Row {
  reference: string;
  address: string;
  proposal: string;
  url: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function blockUrl(year: number, block: number): string {
  const filter = `^APPLICATION_NUMBER^ LIKE '${year}/${block}%'`;
  const params = new URLSearchParams({
    requesttype: "parsetemplate",
    template: "AdvancedSearchResultsTab.tmplt",
    basepage: "ebc_planning.aspx",
  });
  return `${BASE}?${params}&Filter=${encodeURIComponent(filter)}`;
}

async function readBlock(year: number, block: number): Promise<Row[]> {
  const res = await fetch(blockUrl(year, block), {
    headers: { "User-Agent": UA },
    cache: "no-store",
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`Elmbridge register answered HTTP ${res.status} for ${year}/${block}xx`);
  const $ = cheerio.load(await res.text());
  const rows: Row[] = [];
  $("#atWeeklyListTable tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 3) return;
    const reference = $(cells[0]).text().trim();
    if (!/^\d{4}\/\d+$/.test(reference)) return;
    rows.push({
      reference,
      address: $(cells[1]).text().replace(/\s+/g, " ").trim(),
      proposal: $(cells[2]).text().replace(/\s+/g, " ").trim(),
      url: $(cells[3]).find("a").attr("href") ?? null,
    });
  });
  return rows;
}

/** "2026/2403" -> { year: 2026, number: 2403 } */
function parseReference(ref: string | null): { year: number; number: number } | null {
  const m = ref?.match(/^(\d{4})\/(\d+)$/);
  return m ? { year: Number(m[1]), number: Number(m[2]) } : null;
}

async function newestStored(): Promise<{ year: number; number: number }> {
  const leads = await prisma.planningApplication.findMany({
    where: { council: COUNCIL, lpaReference: { not: null } },
    select: { lpaReference: true },
  });
  const thisYear = new Date().getFullYear();
  let newest = { year: thisYear, number: 0 };
  for (const l of leads) {
    const r = parseReference(l.lpaReference);
    if (r && (r.year > newest.year || (r.year === newest.year && r.number > newest.number))) newest = r;
  }
  // A new year restarts the numbering.
  return newest.year < thisYear ? { year: thisYear, number: 0 } : newest;
}

async function hasRecentScan(): Promise<boolean> {
  const since = new Date(Date.now() - MIN_HOURS_BETWEEN_SCANS * 3_600_000);
  return (await prisma.automationRun.findFirst({ where: { type: RUN_TYPE, status: "completed", startedAt: { gte: since } } })) !== null;
}

/**
 * Store new 1-9 home schemes from Elmbridge's register. Once a day unless
 * `force`; `fromNumber` re-reads from an earlier reference (a backfill).
 */
export async function scanElmbridge(opts?: { force?: boolean; fromNumber?: number }): Promise<{
  read: number;
  shortlisted: number;
  found: number;
  skipped?: string;
}> {
  if (!opts?.force && (await hasRecentScan())) {
    return { read: 0, shortlisted: 0, found: 0, skipped: `Elmbridge was scanned in the last ${MIN_HOURS_BETWEEN_SCANS}h` };
  }
  const run = await prisma.automationRun.create({ data: { type: RUN_TYPE, status: "running" } });

  try {
    const newest = await newestStored();
    const startNumber = opts?.fromNumber ?? Math.max(0, newest.number - 100);
    const firstBlock = Math.floor(startNumber / 100);
    const lastBlock = Math.floor(newest.number / 100) + BLOCKS_AHEAD;

    const rows: Row[] = [];
    for (let block = firstBlock; block <= lastBlock; block++) {
      if (rows.length) await sleep(REQUEST_GAP_MS);
      const found = await readBlock(newest.year, block);
      // An empty block past the newest stored one is the end of the register.
      if (found.length === 0 && block * 100 > newest.number) break;
      rows.push(...found);
    }

    const existing = await prisma.planningApplication.findMany({
      where: { council: COUNCIL, lpaReference: { in: rows.map((r) => r.reference) } },
      select: { lpaReference: true },
    });
    const known = new Set(existing.map((e) => e.lpaReference));
    const shortlist = rows.filter((r) => !known.has(r.reference) && looksLikeSchemeText(r.proposal, null));

    const counts: Array<number | null> = [];
    for (let i = 0; i < shortlist.length; i += 40) {
      counts.push(...(await readNewHomes(shortlist.slice(i, i + 40).map((r) => r.proposal))));
    }

    let found = 0;
    for (const [i, row] of shortlist.entries()) {
      const units = counts[i];
      if (units === null || units < MIN_UNITS || units > MAX_UNITS) continue;
      await prisma.planningApplication.create({
        data: {
          reference: `iShare-Elmbridge-${row.reference}`,
          lpaReference: row.reference,
          council: COUNCIL,
          address: row.address || `${COUNCIL} (ref ${row.reference})`,
          description: row.proposal,
          units,
          status: "submitted",
          councilUrl: row.url,
          // The register's search doesn't give a date; the scan finds new ones within a day.
          submittedAt: new Date(),
          alertSent: true,
        },
      });
      found++;
    }

    await prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        summary: `Read ${rows.length} Elmbridge applications from the council register (${newest.year}/${firstBlock}xx-${lastBlock}xx). ${shortlist.length} looked like schemes, ${found} new ${MIN_UNITS}-${MAX_UNITS} home schemes stored.`,
      },
    });
    return { read: rows.length, shortlisted: shortlist.length, found };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.automationRun.update({ where: { id: run.id }, data: { status: "failed", completedAt: new Date(), error: message } });
    throw error;
  }
}
