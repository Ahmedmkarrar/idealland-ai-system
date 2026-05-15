import { Resend } from "resend";
import { withRetry } from "@/lib/retry";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.ALERT_EMAIL_FROM ?? "noreply@placeholder.com";
const TO = (process.env.ALERT_EMAIL_TO ?? "alerts@placeholder.com").split(",").map((e) => e.trim());

interface PlanningAlertPayload {
  reference: string;
  address: string;
  council: string;
  units: number;
  description: string;
  submittedAt: Date;
}

export async function sendPlanningAlert(applications: PlanningAlertPayload[]): Promise<void> {
  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY.includes("PLACEHOLDER")) {
    console.log("[email] RESEND_API_KEY not set — skipping alert email");
    return;
  }

  const count = applications.length;
  const subject = `🏗️ ${count} new planning application${count > 1 ? "s" : ""} detected — London`;

  const rows = applications
    .map(
      (app) => `
      <tr style="border-bottom:1px solid #eee">
        <td style="padding:12px 8px;font-family:monospace;font-size:13px">${app.reference}</td>
        <td style="padding:12px 8px;font-size:14px">${app.address}</td>
        <td style="padding:12px 8px;font-size:14px">${app.council}</td>
        <td style="padding:12px 8px;font-size:14px;font-weight:bold;text-align:center">${app.units}</td>
      </tr>`
    )
    .join("");

  const html = `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto">
      <div style="background:#0f172a;padding:24px 32px;border-radius:8px 8px 0 0">
        <h1 style="color:#fff;margin:0;font-size:20px">New Planning Applications Detected</h1>
        <p style="color:#94a3b8;margin:8px 0 0">${new Date().toLocaleDateString("en-GB", { dateStyle: "full" })}</p>
      </div>
      <div style="background:#f8fafc;padding:24px 32px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none">
        <p style="color:#334155;font-size:15px">
          <strong>${count}</strong> new residential development${count > 1 ? "s" : ""} of 10+ units ${count > 1 ? "have" : "has"} been submitted for planning approval.
        </p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px">
          <thead>
            <tr style="background:#e2e8f0">
              <th style="padding:10px 8px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase">Reference</th>
              <th style="padding:10px 8px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase">Address</th>
              <th style="padding:10px 8px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase">Borough</th>
              <th style="padding:10px 8px;text-align:center;font-size:12px;color:#64748b;text-transform:uppercase">Units</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0">
          <p style="color:#64748b;font-size:13px;margin:0">
            Automated alert from your planning sourcing system.
          </p>
        </div>
      </div>
    </div>
  `;

  await withRetry(() => resend.emails.send({ from: FROM, to: TO, subject, html }));
}

interface DecisionAlertPayload {
  reference: string;
  address: string;
  council: string;
  units: number;
  fromStatus: string;
  toStatus: string;
}

export async function sendDecisionAlert(payload: DecisionAlertPayload): Promise<void> {
  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY.includes("PLACEHOLDER")) {
    console.log("[email] RESEND_API_KEY not set — skipping decision alert");
    return;
  }

  const isApproved = payload.toStatus === "approved";
  const statusLabel = payload.toStatus.charAt(0).toUpperCase() + payload.toStatus.slice(1);
  const color = isApproved ? "#16a34a" : payload.toStatus === "refused" ? "#dc2626" : "#64748b";
  const subject = `${isApproved ? "✅" : "❌"} Planning ${statusLabel}: ${payload.reference} — ${payload.council}`;

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:${color};padding:24px 32px;border-radius:8px 8px 0 0">
        <h1 style="color:#fff;margin:0;font-size:20px">Planning Decision: ${statusLabel}</h1>
        <p style="color:rgba(255,255,255,0.8);margin:8px 0 0">${new Date().toLocaleDateString("en-GB", { dateStyle: "full" })}</p>
      </div>
      <div style="background:#f8fafc;padding:24px 32px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none">
        <table style="width:100%;border-collapse:collapse">
          ${[
            ["Reference", payload.reference],
            ["Address", payload.address],
            ["Borough", payload.council],
            ["Units", String(payload.units)],
            ["Decision", statusLabel],
          ].map(([label, value]) => `
            <tr>
              <td style="padding:8px 0;font-size:13px;color:#64748b;width:120px">${label}</td>
              <td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:${label === "Decision" ? "bold" : "normal"}">${value}</td>
            </tr>
          `).join("")}
        </table>
      </div>
    </div>
  `;

  await withRetry(() => resend.emails.send({ from: FROM, to: TO, subject, html }));
}
