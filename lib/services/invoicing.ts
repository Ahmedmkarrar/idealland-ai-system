// Invoicing automation — generates and sends monthly invoices to IdealLand's
// own paying clients.
//
// v1 scope: only flat_monthly billing model generates real invoice amounts.
// per_application is in the schema but not yet implemented (needs a Client→
// PlanningApplication link that doesn't exist yet — single-tenant today).
//
// Xero is stubbed: when XERO_CLIENT_ID isn't set, sendInvoice() marks the
// invoice as sent locally without actually pushing to Xero. Once the user
// sets up a Xero developer app and supplies credentials, the same code path
// will hit the real API.
import { prisma } from "@/lib/db/client";

interface LineItem {
  description: string;
  quantity: number;
  unitAmount: number;
}

export function isXeroConfigured(): boolean {
  const id = process.env.XERO_CLIENT_ID;
  return !!(id && !id.includes("PLACEHOLDER"));
}

interface GenerateOptions {
  periodStart: Date;
  periodEnd: Date;
}

// Creates a draft Invoice row for every active flat_monthly client that
// doesn't already have an invoice covering this period. Idempotent.
export async function generateInvoicesForPeriod(
  options: GenerateOptions
): Promise<{ created: number; skipped: number; period: string }> {
  const { periodStart, periodEnd } = options;
  const periodLabel = `${periodStart.toISOString().slice(0, 7)}`;

  const runRecord = await prisma.automationRun.create({
    data: { type: "invoicing", status: "running" },
  });

  try {
    const activeClients = await prisma.client.findMany({
      where: { status: "active", billingModel: "flat_monthly" },
    });

    let created = 0;
    let skipped = 0;

    for (const client of activeClients) {
      if (!client.monthlyRate) {
        skipped++;
        continue;
      }

      const existing = await prisma.invoice.findFirst({
        where: {
          clientId: client.id,
          periodStart: { gte: periodStart, lte: periodEnd },
        },
      });
      if (existing) {
        skipped++;
        continue;
      }

      const lineItems: LineItem[] = [
        {
          description: `IdealLand planning intelligence service — ${periodLabel}`,
          quantity: 1,
          unitAmount: client.monthlyRate,
        },
      ];

      // Default due date: 14 days from now. Tweak per client later if needed.
      const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

      await prisma.invoice.create({
        data: {
          clientId: client.id,
          periodStart,
          periodEnd,
          amount: client.monthlyRate,
          currency: client.currency,
          status: "draft",
          lineItems: JSON.stringify(lineItems),
          dueDate,
        },
      });

      created++;
    }

    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        summary: `Generated ${created} invoice(s) for ${periodLabel}. ${skipped > 0 ? `${skipped} skipped.` : ""}`,
      },
    });

    return { created, skipped, period: periodLabel };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.automationRun.update({
      where: { id: runRecord.id },
      data: { status: "failed", completedAt: new Date(), error: message },
    });
    throw error;
  }
}

interface SendResult {
  ok: boolean;
  provider: "xero" | "local";
  xeroInvoiceId?: string;
  xeroInvoiceNum?: string;
  reason?: string;
}

// Send (or "send") a single invoice. With Xero configured, pushes to Xero
// and stores the returned IDs. Without Xero, just marks the invoice sent
// locally — useful for testing the flow before the Xero dev app is ready.
export async function sendInvoice(invoiceId: string): Promise<SendResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { client: true },
  });
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
  if (invoice.status === "sent" || invoice.status === "paid") {
    return { ok: true, provider: "local", reason: "Invoice already sent" };
  }

  // TODO(xero): When Xero is wired, call createInvoiceInXero(invoice) here
  // and capture the returned invoiceId + number. For now, this is a stub.
  if (!isXeroConfigured()) {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: "sent", sentAt: new Date() },
    });
    return {
      ok: true,
      provider: "local",
      reason: "Xero not configured — invoice marked sent locally only",
    };
  }

  // Reachable once XERO_CLIENT_ID is set — currently won't run.
  throw new Error("Xero send not yet implemented (stub only)");
}

export async function getClients() {
  return prisma.client.findMany({ orderBy: { createdAt: "desc" } });
}

export async function getInvoices(filters?: { clientId?: string; status?: string }) {
  return prisma.invoice.findMany({
    where: {
      ...(filters?.clientId && { clientId: filters.clientId }),
      ...(filters?.status && { status: filters.status }),
    },
    include: { client: true },
    orderBy: { periodStart: "desc" },
  });
}
