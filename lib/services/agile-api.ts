// Wandsworth's planning register, Agile Applications (since Sep 2026). Shared by
// the daily scan (lib/services/agile.ts) and the register reader
// (lib/services/portal-extract.ts).
//
// The API answers only from the UK — anywhere else gets a "request is blocked"
// page — so it works on the droplet and fails on a dev laptop abroad.

const API_URL = "https://planningapi.agileapplications.co.uk/api";
const PORTAL_URL = "https://planning.wandsworth.gov.uk/wandsworth";
const HEADERS = {
  "x-client": "WANDSWORTH",
  "x-product": "CITIZENPORTAL",
  "x-service": "PA",
  Accept: "application/json",
};

export interface AgileSummary {
  id: number;
  reference: string;
  applicationType: string | null;
  proposal: string | null;
  location: string | null;
  decisionText: string | null;
  validDate: string | null;
  decisionDate: string | null;
}

export interface AgileDetail {
  decisionText?: string | null;
  decisionDate?: string | null;
  fullProposal?: string | null;
  applicantSurname?: string | null;
  agentName?: string | null;
  agentForename?: string | null;
  agentSurname?: string | null;
  agentContactName?: string | null;
  agentEmail?: string | null;
  agentTelephoneNumber?: string | null;
}

export const text = (v: string | null | undefined) => (v ?? "").trim() || null;

export async function agileGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(30000) });
  const body = await res.text();
  if (!res.ok || body.startsWith("<")) {
    const blocked = body.startsWith("<") ? " with a block page — it only answers UK addresses" : "";
    throw new Error(`Wandsworth register (Agile) answered HTTP ${res.status}${blocked} for ${path}`);
  }
  return JSON.parse(body) as T;
}

/** The page Lucy opens for an application. */
export function wandsworthApplicationUrl(id: number): string {
  return `${PORTAL_URL}/application-details/${id}`;
}

const APPLICATION_URL = /^https?:\/\/planning\.wandsworth\.gov\.uk\/wandsworth\/application-details\/(\d+)/i;

export function agileIdFromUrl(url: string): number | null {
  const m = url.match(APPLICATION_URL);
  return m ? Number(m[1]) : null;
}

/** The application with this council reference ("2026/1951"), or null. */
export async function findWandsworthByReference(reference: string): Promise<AgileSummary | null> {
  const page = await agileGet<{ results?: AgileSummary[] } | unknown[]>(
    `/application/search?reference=${encodeURIComponent(reference)}`
  );
  if (Array.isArray(page)) return null;
  return page.results?.find((r) => r.reference === reference) ?? null;
}

interface AgileDocument {
  documentHash: string;
  mediaDescription: string | null;
}

/** The submitted application form for an application, as a PDF, or null. */
export async function wandsworthApplicationForm(id: number): Promise<ArrayBuffer | null> {
  const docs = await agileGet<AgileDocument[]>(`/application/${id}/document`).catch(() => [] as AgileDocument[]);
  const form = Array.isArray(docs) ? docs.find((d) => /application form/i.test(d.mediaDescription ?? "")) : undefined;
  if (!form) return null;
  const res = await fetch(`${API_URL}/application/document/WANDSWORTH/${form.documentHash}`, {
    headers: HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("pdf")) return null;
  return res.arrayBuffer();
}
