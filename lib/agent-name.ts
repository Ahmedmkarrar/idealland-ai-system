// Recovering the agent's name when a contact only gives a firm and an email.
//
// Lucy (4 Nov 2026): letters were "missing the agent's name" — 20 on Ready to
// Send opened "Good afternoon" though the person was plain to see, e.g.
// eva.papai@rokplanning.co.uk, or timodyarchitect@gmail.com for "Tim Ody Architect".
//
// A wrong "Dear ___" is worse than none (the "Dear Joshua" letter, 1 Oct), so a
// name is only read from:
//   - a first.last mailbox on an email the council's register gave us, or
//   - a mailbox that spells out a firm named after its principal ("Tim Ody
//     Architect" + timodyarchitect@), which names the sole practitioner.
// A first name alone (zaheer@) is not used: the greeting needs a full name.
//
// Dependency-free so it can be shared by the register reader and the researcher.

export const NAME_FROM_MAILBOX = "Name read from their own email address";

const GENERIC_MAILBOX =
  /^(info|hello|office|admin|enquiries|enquiry|mail|post|studio|design|designer|property|planning|contact|team|reception|accounts|sales|general|architects?|projects?|london)$/;

const PRACTICE_WORD =
  /^(ltd|limited|llp|plc|architects?|architecture|architectural|planning|planners?|associates|consult\w*|design|designs|studio|partners(hip)?|group|surveyors?|developments?|homes|properties|uk|co|&|and)$/i;

const titleCase = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

function mailbox(email: string | null): string | null {
  return email?.split("@")[0]?.toLowerCase() ?? null;
}

/** "eva.papai@…" -> "Eva Papai". */
export function nameFromFirstLast(email: string | null): string | null {
  const m = mailbox(email)?.match(/^([a-z]{2,})[._-]([a-z]{2,})$/);
  if (!m || GENERIC_MAILBOX.test(m[1]) || GENERIC_MAILBOX.test(m[2])) return null;
  return `${titleCase(m[1])} ${titleCase(m[2])}`;
}

/** "Tim Ody Architect" + timodyarchitect@ -> "Tim Ody". */
export function principalOfFirm(email: string | null, firm: string | null): string | null {
  const box = mailbox(email)?.replace(/[^a-z]/g, "");
  if (!box || !firm) return null;
  const words = firm.replace(/\(.*?\)/g, " ").trim().split(/\s+/);
  const person = words.filter((w) => !PRACTICE_WORD.test(w));
  // Exactly a first name and a surname, followed only by practice words.
  if (person.length !== 2 || words.slice(0, 2).join(" ") !== person.join(" ")) return null;
  if (!person.every((w) => /^[A-Za-z][a-z'-]+$/.test(w) || /^[A-Z]{2,}$/.test(w))) return null;
  const joined = person.join("").toLowerCase();
  return box.startsWith(joined) ? person.map(titleCase).join(" ") : null;
}

/** The agent's name from their mailbox, or null when it can't be told safely. */
export function nameFromMailbox(email: string | null, firm: string | null, fromRegister: boolean): string | null {
  return principalOfFirm(email, firm) ?? (fromRegister ? nameFromFirstLast(email) : null);
}

/** "CHARLES PARK" -> "Charles Park"; mixed case is left as typed. */
export function tidyName(name: string): string {
  return name === name.toUpperCase() ? name.split(/\s+/).map(titleCase).join(" ") : name;
}
