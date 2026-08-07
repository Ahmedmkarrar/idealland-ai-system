// Addressing and last-moment tidying for the seller-approach email.
//
// The dashboard never sends: staff hit Copy or Open in email and it leaves from
// their own mailbox. So these are the only levers we have over who receives a
// copy and what the greeting says at the moment it actually goes out.

/** James is copied so he sees every approach going out in his name. */
export const APPROACH_CC =
  process.env.NEXT_PUBLIC_IDEALLAND_APPROACH_CC ?? "james@idealland.co.uk";

/** Lucy is blind-copied — she files them, and the agent needn't see that. */
export const APPROACH_BCC =
  process.env.NEXT_PUBLIC_IDEALLAND_APPROACH_BCC ?? "admin@idealland.co.uk";

/** "Good morning," before noon in London, "Good afternoon," after. */
export function timeGreeting(now: Date = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric", hour12: false, timeZone: "Europe/London",
    }).format(now)
  );
  return hour < 12 ? "Good morning," : "Good afternoon,";
}

/**
 * Drafts are written ahead of time — the overnight job writes them at 08:00 and
 * they may not be sent for days. Rather than let a letter go out saying "Good
 * morning" at four in the afternoon, the greeting is refreshed at the moment it
 * is copied or opened. Only a leading time-of-day greeting is touched; "Dear
 * Simon," is left exactly as written.
 */
export function refreshGreeting(body: string | null, now: Date = new Date()): string {
  if (!body) return "";
  return body.replace(/^\s*Good (morning|afternoon),/i, timeGreeting(now));
}

/** mailto: with the approach ready to send, cc'd and bcc'd per Lucy's request. */
export function approachMailto(
  to: string,
  subject: string | null,
  body: string | null
): string {
  const params = new URLSearchParams({
    subject: subject ?? "",
    body: refreshGreeting(body),
  });
  if (APPROACH_CC.trim()) params.set("cc", APPROACH_CC.trim());
  if (APPROACH_BCC.trim()) params.set("bcc", APPROACH_BCC.trim());
  return `mailto:${to}?${params}`;
}
