import { NextRequest, NextResponse } from "next/server";
import { generateAndSchedulePosts, getSocialPosts } from "@/lib/services/social";
import { applyRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const posts = await getSocialPosts({ platform, status });
  return NextResponse.json({ posts });
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 10 });
  if (rateLimitResponse) return rateLimitResponse;

  const body = await request.json().catch(() => ({}));
  const result = await generateAndSchedulePosts(body.applicationId);
  return NextResponse.json(result);
}
