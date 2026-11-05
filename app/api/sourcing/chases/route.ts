// Chase-ups due on the Sent page (lib/services/chase.ts), and Lucy marking one sent.
import { NextRequest, NextResponse } from "next/server";
import { chaseUpsDue, markChased } from "@/lib/services/chase";
import { applyRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 60 });
  if (rateLimitResponse) return rateLimitResponse;
  return NextResponse.json({ chases: await chaseUpsDue() });
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 30 });
  if (rateLimitResponse) return rateLimitResponse;
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown; chased?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  if (ids.length === 0) return NextResponse.json({ error: "ids required" }, { status: 400 });
  const updated = await markChased(ids, body.chased !== false);
  return NextResponse.json({ ok: true, updated });
}
