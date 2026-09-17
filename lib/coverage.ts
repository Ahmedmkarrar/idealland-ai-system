// The areas IdealLand actually works.
//
// Lucy asked on 17 Sep 2026 to stop sourcing across all 33 London boroughs and
// keep only the patch her buyers want: six boroughs in south-west London and five
// Surrey districts next door. Everything that fetches, scores, researches or
// lists leads reads this one list, so the system never spends money on, or asks
// her to look at, a site she has said she won't work.
//
// Leads already stored outside these areas are set aside, not deleted — anything
// she has already written to stays on the Sent page, and adding an area back
// brings its leads straight back.
//
// Dependency-free so the dashboard pages can import it too.

export type CoverageRegion = "london" | "surrey";

export interface CoverageArea {
  /** Exactly as stored in PlanningApplication.council. */
  council: string;
  region: CoverageRegion;
  /** The authority name PlanIt uses — Surrey districts only, which aren't in the London feed. */
  planitAuthority?: string;
}

export const COVERAGE_AREAS: readonly CoverageArea[] = [
  { council: "Kingston", region: "london" },
  { council: "Merton", region: "london" },
  { council: "Wandsworth", region: "london" },
  { council: "Hammersmith & Fulham", region: "london" },
  { council: "Lambeth", region: "london" },
  { council: "Lewisham", region: "london" },
  { council: "Elmbridge", region: "surrey", planitAuthority: "Elmbridge" },
  { council: "Epsom & Ewell", region: "surrey", planitAuthority: "Epsom and Ewell" },
  { council: "Guildford", region: "surrey", planitAuthority: "Guildford" },
  { council: "Mole Valley", region: "surrey", planitAuthority: "Mole Valley" },
  { council: "Reigate & Banstead", region: "surrey", planitAuthority: "Reigate" },
];

/** "Hammersmith and Fulham", "Royal Borough of Kingston upon Thames" -> one comparable key. */
function areaKey(council: string): string {
  return council
    .toLowerCase()
    .replace(/^(the\s+)?(london\s+borough\s+of|royal\s+borough\s+of)\s+/, "")
    .replace(/\s+upon\s+thames$/, "")
    .replace(/\b(council|borough)\b/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

const AREA_BY_KEY = new Map(COVERAGE_AREAS.map((a) => [areaKey(a.council), a]));

/** The coverage area a council belongs to, or null when it is outside the patch. */
export function coverageArea(council: string): CoverageArea | null {
  return AREA_BY_KEY.get(areaKey(council)) ?? null;
}

export function isCoveredCouncil(council: string): boolean {
  return coverageArea(council) !== null;
}

/** Stored council names, for a Prisma `council: { in: [...] }` filter. */
export const COVERED_COUNCILS: string[] = COVERAGE_AREAS.map((a) => a.council);

/** Prisma where-fragment limiting a lead query to the covered areas. */
export const inCoverage = { council: { in: COVERED_COUNCILS } };

/** "Kingston, Merton, … and Reigate & Banstead" — for page subtitles and emails. */
export function coverageSummary(): string {
  const names = COVERAGE_AREAS.map((a) => a.council);
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
