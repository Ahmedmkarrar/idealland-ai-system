import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    resend: !!(process.env.RESEND_API_KEY && !process.env.RESEND_API_KEY.includes("PLACEHOLDER")),
    anthropic: !!(process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes("PLACEHOLDER")),
    openai: !!(process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes("PLACEHOLDER")),
    hmlr: !!(process.env.HMLR_API_KEY && !process.env.HMLR_API_KEY.includes("PLACEHOLDER")),
    cronSecret: !!(process.env.CRON_SECRET && !process.env.CRON_SECRET.includes("replace_with")),
    mixmax: !!(process.env.MIXMAX_API_KEY && !process.env.MIXMAX_API_KEY.includes("PLACEHOLDER")),
    xero: !!(process.env.XERO_CLIENT_ID && !process.env.XERO_CLIENT_ID.includes("PLACEHOLDER")),
  });
}
