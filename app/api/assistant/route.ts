// Chat endpoint for Lucy's sourcing assistant. Takes the conversation so far and
// returns the assistant's next reply. Read + safe additive actions only.
import { NextRequest, NextResponse } from "next/server";
import { runAssistant, type ChatMessage } from "@/lib/services/assistant";
import { applyRateLimit } from "@/lib/rate-limit";

interface Body {
  messages?: ChatMessage[];
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 30 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = (await request.json().catch(() => ({}))) as Body;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return NextResponse.json({ ok: false, reason: "No messages provided." }, { status: 400 });
  }

  // Keep the window bounded so a long chat can't balloon the prompt.
  const trimmed = messages.slice(-16).filter(
    (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
  );

  const result = await runAssistant(trimmed);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
