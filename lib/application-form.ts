// The agent section of a Planning Portal application form (the national "1APP"
// form most applications are filed on). Its text reads, after PDF extraction:
//   "Agent Details Name/Company Title MR First name ASH Surname BHATIA
//    Company Name SILVERLINE ARCHITECTS LTD Address ..."
// Councils' registers often keep less than the form says — Wandsworth's API has
// "SH BHATIA" and no firm for that one (Lucy, 4 Nov 2026) — so the form is read
// when the register doesn't name a clear person.

import { extractText, getDocumentProxy } from "unpdf";

export interface FormAgent {
  title: string | null;
  firstName: string | null;
  surname: string | null;
  company: string | null;
}

const FIELD = (label: string, next: string) =>
  new RegExp(`${label}\\s+(.*?)\\s+(?=${next})`, "i");

const clean = (v: string | undefined) => {
  const t = v?.replace(/\s+/g, " ").trim();
  return t && !/^(n\/?a|none|-|redacted)$/i.test(t) && !/\*{3}/.test(t) ? t : null;
};

export function parseFormAgent(text: string): FormAgent | null {
  const start = text.search(/Agent Details/i);
  if (start === -1) return null;
  const section = text.slice(start, start + 600);
  const title = clean(section.match(FIELD("Title", "First name"))?.[1]);
  const firstName = clean(section.match(FIELD("First name", "Surname"))?.[1]);
  const surname = clean(section.match(FIELD("Surname", "Company Name|Address|Contact Details"))?.[1]);
  const company = clean(section.match(FIELD("Company Name", "Address|Contact Details"))?.[1]);
  if (!firstName && !surname && !company) return null;
  return { title, firstName, surname, company };
}

export async function formAgentFromPdf(bytes: ArrayBuffer): Promise<FormAgent | null> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return parseFormAgent(text);
  } catch {
    return null;
  }
}
