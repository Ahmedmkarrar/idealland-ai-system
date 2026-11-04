// Agent contact discovery for a planning application (or the top undone leads).
import { NextRequest, NextResponse } from "next/server";
import { findAgentContact, bulkFindContacts, draftApproach } from "@/lib/services/contact-finder";
import { applyRateLimit } from "@/lib/rate-limit";

interface Body {
  applicationId?: string;
  force?: boolean;
  bulk?: boolean;
  minScore?: number;
  limit?: number;
  autoDraft?: boolean;
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 20 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = (await request.json().catch(() => ({}))) as Body;

  if (body.bulk) {
    const result = await bulkFindContacts({
      minScore: typeof body.minScore === "number" ? body.minScore : undefined,
      limit: typeof body.limit === "number" ? body.limit : undefined,
      autoDraft: body.autoDraft === true,
    });
    return NextResponse.json(result);
  }

  if (!body.applicationId) {
    return NextResponse.json({ error: "applicationId or bulk=true required" }, { status: 400 });
  }

  const result = await findAgentContact(body.applicationId, { force: body.force });
  // "Try again" on Ready's Needs-an-agent list: a found agent gets a letter straight away.
  if (body.autoDraft && result.ok && result.result?.found) await draftApproach(body.applicationId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
