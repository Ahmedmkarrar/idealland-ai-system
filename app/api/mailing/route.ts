import { NextRequest, NextResponse } from "next/server";
import { addContact, createCampaign, sendCampaign, getContacts, getCampaigns } from "@/lib/services/mailing";
import { applyRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") ?? "campaigns";

  if (view === "contacts") {
    const type = searchParams.get("type") ?? undefined;
    const contacts = await getContacts({ type });
    return NextResponse.json({ contacts });
  }

  const campaigns = await getCampaigns();
  return NextResponse.json({ campaigns });
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 10 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = await request.json().catch(() => ({}));

  if (body.action === "addContact") {
    const result = await addContact(body);
    return NextResponse.json(result);
  }

  if (body.action === "send" && body.campaignId) {
    const result = await sendCampaign(body.campaignId);
    return NextResponse.json(result);
  }

  const result = await createCampaign({
    subject: body.subject ?? "New Property Opportunity from IdealLand",
    content: body.content ?? "We have exciting new developments to share with you.",
    recipientTypes: body.recipientTypes,
    recipientTags: body.recipientTags,
  });

  return NextResponse.json(result);
}
