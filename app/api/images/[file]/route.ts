// Serves AI-generated images persisted by lib/services/images.ts.
//
// Nginx proxies everything to the app and has no alias block for a disk path,
// so the bytes are streamed from here rather than served statically.
//
// Note this sits under /api/, which middleware.ts treats as public. That is
// acceptable: the content is a generic architectural render, and filenames are
// random UUIDs. readStoredImage() rejects any name outside that shape, so the
// path can never escape the storage dir.
import { NextRequest, NextResponse } from "next/server";
import { readStoredImage } from "@/lib/services/images";
import { applyRateLimit } from "@/lib/rate-limit";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ file: string }> }
) {
  const rateLimitResponse = applyRateLimit(request, { maxRequests: 120 });
  if (rateLimitResponse) return rateLimitResponse;

  const { file } = await context.params;
  const bytes = await readStoredImage(file);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/png",
      // Filenames are content-addressed by UUID and never rewritten, so the
      // bytes behind a given URL are immutable.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
