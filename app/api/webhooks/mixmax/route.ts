import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

// Mixmax event types we care about
type MixmaxEventType = "email.opened" | "email.link_clicked" | "email.replied" | "email.bounced";

interface MixmaxEvent {
  type: MixmaxEventType;
  message?: {
    id?: string;
  };
  link?: string;
}

interface MixmaxWebhookPayload {
  events?: MixmaxEvent[];
}

export async function POST(request: NextRequest) {
  // Validate Mixmax webhook secret if configured
  const webhookSecret = process.env.MIXMAX_WEBHOOK_SECRET;
  if (webhookSecret) {
    const signature = request.headers.get("x-mixmax-signature");
    if (signature !== webhookSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let payload: MixmaxWebhookPayload;
  try {
    payload = (await request.json()) as MixmaxWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const events = payload.events ?? [];

  for (const event of events) {
    const mixmaxMessageId = event.message?.id;
    if (!mixmaxMessageId) continue;

    const recipient = await prisma.mailingRecipient.findFirst({
      where: { mixmaxMessageId },
    });
    if (!recipient) continue;

    if (event.type === "email.opened") {
      await prisma.mailingRecipient.update({
        where: { id: recipient.id },
        data: { status: "opened" },
      });

      // Increment campaign open count
      await prisma.mailingCampaign.update({
        where: { id: recipient.campaignId },
        data: { openCount: { increment: 1 } },
      });
    }

    if (event.type === "email.link_clicked") {
      await prisma.mailingRecipient.update({
        where: { id: recipient.id },
        data: { status: "clicked" },
      });

      await prisma.mailingCampaign.update({
        where: { id: recipient.campaignId },
        data: { clickCount: { increment: 1 } },
      });
    }

    if (event.type === "email.bounced") {
      await prisma.mailingRecipient.update({
        where: { id: recipient.id },
        data: { status: "bounced" },
      });
    }
  }

  return NextResponse.json({ received: events.length });
}
