// PDF text extraction for the AI Content Factory.
//
// Fetches a PDF from a URL and returns its plain text. Used by social.ts to
// feed actual planning-application document text into Claude's prompt so the
// drafted posts reference real design details, applicant names, ownership,
// etc. — not just the bare metadata (council/units/description).
//
// All functions GRACEFULLY return null on failure (404, timeout, parse error,
// non-PDF response). Callers must treat PDF context as optional enrichment,
// not a hard dependency, since many of the seeded URLs in dev are mock and
// most real council portals require session cookies that we don't have yet.
import { prisma } from "@/lib/db/client";
import { extractText, getDocumentProxy } from "unpdf";

// Per-document text cap. 30K chars ≈ ~7.5K tokens — safe headroom for haiku-4-5's
// 200K context while leaving room for the prompt scaffolding + other docs.
const MAX_CHARS_PER_DOC = 30_000;

// Total context cap when concatenating across all docs for one application.
const MAX_CHARS_PER_APP = 60_000;

// Below this, the PDF didn't yield enough text to give Claude anything specific
// to reference (typical of placeholder PDFs, broken extractions, or single-line
// title-only docs). Returning "" here makes generateContentWithClaude fall back
// to metadata-only mode rather than producing self-defeating "I can't find details
// in this PDF" posts.
const MIN_USEFUL_TOTAL_CHARS = 400;

const FETCH_TIMEOUT_MS = 15_000;

export async function extractPdfText(url: string): Promise<string | null> {
  if (!url) return null;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; planning-monitor/1.0)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("pdf")) return null;

    const buffer = new Uint8Array(await res.arrayBuffer());
    const pdf = await getDocumentProxy(buffer);
    const { text } = await extractText(pdf, { mergePages: true });

    if (!text) return null;
    const cleaned = text.replace(/\s+/g, " ").trim();
    return cleaned.length > MAX_CHARS_PER_DOC ? cleaned.slice(0, MAX_CHARS_PER_DOC) + "…" : cleaned;
  } catch {
    return null;
  }
}

interface DocContext {
  type: string;
  name: string;
  text: string;
}

// Returns the concatenated PDF text for all retrieved documents on an
// application, labelled by document name so the LLM can attribute facts back
// to a source. Returns "" if no retrievable PDF text exists.
export async function gatherPdfContextForApp(applicationId: string): Promise<string> {
  const documents = await prisma.document.findMany({
    where: { applicationId, status: "retrieved", url: { not: null } },
  });

  if (documents.length === 0) return "";

  const extractions = await Promise.all(
    documents.map(async (doc): Promise<DocContext | null> => {
      const text = await extractPdfText(doc.url!);
      if (!text) return null;
      return { type: doc.type, name: doc.name, text };
    })
  );

  const successful = extractions.filter((e): e is DocContext => e !== null);
  if (successful.length === 0) return "";

  let combined = "";
  for (const doc of successful) {
    const section = `\n\n--- ${doc.name} (${doc.type}) ---\n${doc.text}`;
    if (combined.length + section.length > MAX_CHARS_PER_APP) {
      combined += "\n\n[…additional documents truncated to fit context window]";
      break;
    }
    combined += section;
  }

  const trimmed = combined.trim();
  return trimmed.length >= MIN_USEFUL_TOTAL_CHARS ? trimmed : "";
}
