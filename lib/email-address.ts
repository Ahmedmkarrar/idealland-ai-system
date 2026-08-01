// Shared, dependency-free email checks — imported by the contact-finder service
// (server) and the dashboard pages (client), so both agree on what counts as a
// sendable address.

// One address, no trailing commentary — web search sometimes returns a house
// pattern with a caveat ("firstname@firm.co.uk (common format; verify contact)").
const SINGLE_ADDRESS = /^[^\s@<>()[\],;:]+@[^\s@<>()[\],;:]+\.[a-z]{2,}$/i;
// ...and sometimes a clean-looking address whose local part is still a template.
const TEMPLATE_LOCAL_PART =
  /^(firstname|first[._-]?name|first[._-]?last|lastname|last[._-]?name|surname|initial|yourname|name|email|user)$/i;

// An address is only usable if we can put it behind a mailto: without sending to
// a placeholder. Anything else comes back as `rejected` so callers can record it
// as a research note rather than offering a one-click send.
export function usableEmail(raw: string | null): { email: string | null; rejected: string | null } {
  if (!raw) return { email: null, rejected: null };
  const candidate = raw.trim().replace(/^mailto:/i, "").replace(/^<|>$/g, "");
  if (!SINGLE_ADDRESS.test(candidate)) return { email: null, rejected: candidate };
  if (TEMPLATE_LOCAL_PART.test(candidate.split("@")[0])) return { email: null, rejected: candidate };
  return { email: candidate, rejected: null };
}

export function isUsableEmail(raw: string | null): boolean {
  return usableEmail(raw).email !== null;
}
