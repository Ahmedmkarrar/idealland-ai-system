import { prisma } from "@/lib/db/client";
import { Resend } from "resend";
import { withRetry } from "@/lib/retry";

interface ContactInput {
  name: string;
  email: string;
  company?: string;
  type: "developer" | "architect" | "investor";
  tags?: string[];
}

interface CampaignInput {
  subject: string;
  content: string;
  recipientTypes?: string[];
  recipientTags?: string[];
}

interface MixmaxSendResult {
  id: string;
}

function isMixmaxConfigured(): boolean {
  const key = process.env.MIXMAX_API_KEY;
  return !!(key && !key.includes("PLACEHOLDER"));
}

function isResendConfigured(): boolean {
  const key = process.env.RESEND_API_KEY;
  return !!(key && !key.includes("PLACEHOLDER"));
}

function personalise(template: string, name: string, company?: string | null): string {
  return template
    .replace(/\{name\}/g, name)
    .replace(/\{company\}/g, company ?? "your company");
}

function buildEmailHtml(content: string, recipientName: string, recipientCompany?: string | null): string {
  const personalised = personalise(content, recipientName, recipientCompany);
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
    ${personalised
      .split("\n")
      .filter(Boolean)
      .map((line) => `<p style="color:#334155;font-size:15px;line-height:1.6">${line}</p>`)
      .join("")}
  </div>`;
}

async function sendViaMixmax(
  recipientEmail: string,
  recipientName: string,
  subject: string,
  htmlBody: string
): Promise<MixmaxSendResult> {
  const response = await fetch("https://api.mixmax.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-token": process.env.MIXMAX_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: [{ name: recipientName, email: recipientEmail }],
      subject,
      body: htmlBody,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Mixmax API error ${response.status}: ${errorBody}`);
  }

  return response.json() as Promise<MixmaxSendResult>;
}

export async function addContact(contact: ContactInput): Promise<{ contactId: string }> {
  const record = await prisma.mailingContact.upsert({
    where: { email: contact.email },
    update: { name: contact.name, company: contact.company, type: contact.type, tags: contact.tags?.join(",") ?? "" },
    create: { name: contact.name, email: contact.email, company: contact.company, type: contact.type, tags: contact.tags?.join(",") ?? "" },
  });
  return { contactId: record.id };
}

export async function createCampaign(input: CampaignInput): Promise<{ campaignId: string }> {
  const contacts = await prisma.mailingContact.findMany({
    where: { active: true, ...(input.recipientTypes && { type: { in: input.recipientTypes } }) },
  });

  const filtered = input.recipientTags
    ? contacts.filter((c) => input.recipientTags!.some((tag) => c.tags.includes(tag)))
    : contacts;

  const campaign = await prisma.mailingCampaign.create({
    data: {
      subject: input.subject,
      content: input.content,
      status: "draft",
      recipientCount: filtered.length,
      recipients: { create: filtered.map((c) => ({ email: c.email, name: c.name, status: "pending" })) },
    },
  });

  return { campaignId: campaign.id };
}

export async function sendCampaign(campaignId: string): Promise<{ sent: number; failed: number; provider: string; reason?: string }> {
  const useMixmax = isMixmaxConfigured();
  const useResend = isResendConfigured();

  if (!useMixmax && !useResend) {
    return { sent: 0, failed: 0, provider: "none", reason: "Neither MIXMAX_API_KEY nor RESEND_API_KEY configured" };
  }

  const campaign = await prisma.mailingCampaign.findUnique({
    where: { id: campaignId },
    include: { recipients: true },
  });
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const runRecord = await prisma.automationRun.create({ data: { type: "mailing", status: "running" } });
  await prisma.mailingCampaign.update({ where: { id: campaignId }, data: { status: "sending" } });

  const provider = useMixmax ? "mixmax" : "resend";
  const resend = useResend && !useMixmax ? new Resend(process.env.RESEND_API_KEY) : null;
  const fromEmail = process.env.ALERT_EMAIL_FROM ?? "noreply@placeholder.com";

  let sent = 0;
  let failed = 0;

  for (const recipient of campaign.recipients) {
    try {
      const html = buildEmailHtml(campaign.content, recipient.name);

      if (useMixmax) {
        const mixmaxResult = await withRetry(() =>
          sendViaMixmax(recipient.email, recipient.name, campaign.subject, html)
        );
        await prisma.mailingRecipient.update({
          where: { id: recipient.id },
          data: { status: "sent", sentAt: new Date(), mixmaxMessageId: mixmaxResult.id },
        });
        sent++;
      } else if (resend) {
        const resendResult = await withRetry(() =>
          resend.emails.send({
            from: fromEmail,
            to: [recipient.email],
            subject: campaign.subject,
            html,
          })
        );
        const isSuccess = !resendResult.error;
        await prisma.mailingRecipient.update({
          where: { id: recipient.id },
          data: { status: isSuccess ? "sent" : "bounced", sentAt: isSuccess ? new Date() : null },
        });
        isSuccess ? sent++ : failed++;
      }
    } catch {
      await prisma.mailingRecipient.update({ where: { id: recipient.id }, data: { status: "bounced" } });
      failed++;
    }
  }

  await prisma.mailingCampaign.update({
    where: { id: campaignId },
    data: { status: "sent", sentAt: new Date() },
  });

  await prisma.automationRun.update({
    where: { id: runRecord.id },
    data: {
      status: "completed",
      completedAt: new Date(),
      summary: `Sent "${campaign.subject}" via ${provider} to ${sent} recipients. ${failed} bounced.`,
    },
  });

  return { sent, failed, provider };
}

export async function autoSendApplicationAlert(applications: Array<{
  reference: string;
  address: string;
  council: string;
  units: number;
  description: string;
}>): Promise<{ campaignId: string; sent: number; failed: number } | null> {
  const developerCount = await prisma.mailingContact.count({
    where: { active: true, type: "developer" },
  });
  if (developerCount === 0) return null;

  const appList = applications
    .map((a) => `• ${a.units}-unit development at ${a.address}, ${a.council} (Ref: ${a.reference})`)
    .join("\n");

  const subject =
    applications.length === 1
      ? `New Land Opportunity: ${applications[0]!.units} units in ${applications[0]!.council}`
      : `${applications.length} New Land Opportunities Identified — London`;

  const content = `Hi {name},

We've identified ${applications.length === 1 ? "a new planning application" : "new planning applications"} that may be of interest to you:

${appList}

These applications were submitted recently and represent early-stage land opportunities. We recommend reviewing them promptly before they reach the open market.

If you'd like further details or to discuss any of these opportunities, please reply to this email.

Best regards,
The IdealLand Team`;

  const { campaignId } = await createCampaign({
    subject,
    content,
    recipientTypes: ["developer"],
  });

  const result = await sendCampaign(campaignId);
  return { campaignId, sent: result.sent, failed: result.failed };
}

export async function getContacts(filters?: { type?: string; active?: boolean }) {
  return prisma.mailingContact.findMany({
    where: {
      ...(filters?.type && { type: filters.type }),
      ...(filters?.active !== undefined && { active: filters.active }),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getCampaigns() {
  return prisma.mailingCampaign.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { recipients: true } } },
  });
}
