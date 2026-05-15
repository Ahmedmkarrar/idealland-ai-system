import { NextRequest, NextResponse } from "next/server";

interface RateLimitRecord {
  timestamps: number[];
}

const store = new Map<string, RateLimitRecord>();

interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
}

function checkRateLimit(
  identifier: string,
  { windowMs = 60_000, maxRequests = 60 }: RateLimitOptions = {}
): { allowed: boolean; resetAt: number } {
  const now = Date.now();
  const record = store.get(identifier) ?? { timestamps: [] };

  const windowStart = now - windowMs;
  record.timestamps = record.timestamps.filter((t) => t > windowStart);

  const resetAt = record.timestamps[0] ? record.timestamps[0] + windowMs : now + windowMs;

  if (record.timestamps.length >= maxRequests) {
    store.set(identifier, record);
    return { allowed: false, resetAt };
  }

  record.timestamps.push(now);
  store.set(identifier, record);
  return { allowed: true, resetAt };
}

export function applyRateLimit(
  request: NextRequest,
  options?: RateLimitOptions
): NextResponse | null {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const { allowed, resetAt } = checkRateLimit(ip, options);

  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)),
          "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
        },
      }
    );
  }

  return null;
}
