// Draft the seller-approach email to the agent, or record what happened after
// staff sent it (status/outcome).
import { NextRequest, NextResponse } from "next/server";
import { draftApproach, setApproachState, isApproachOutcome } from "@/lib/services/contact-finder";
import { applyRateLimit } from "@/lib/rate-limit";

interface Body {
  applicationId?: string;
  force?: boolean;
  status?: "drafted" | "sent";
  outcome?: string | null;
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 30 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.applicationId) {
    return NextResponse.json({ error: "applicationId required" }, { status: 400 });
  }

  // Status/outcome update path (staff marking sent / recording a reply).
  if (body.status !== undefined || body.outcome !== undefined) {
    if (body.outcome != null && !isApproachOutcome(body.outcome)) {
      return NextResponse.json(
        { error: "outcome must be one of: replied, interested, dead, won — or null" },
        { status: 400 }
      );
    }
    const result = await setApproachState(body.applicationId, {
      status: body.status,
      outcome: body.outcome === undefined ? undefined : (body.outcome as never),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  // Default: draft the approach email.
  const result = await draftApproach(body.applicationId, { force: body.force });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
