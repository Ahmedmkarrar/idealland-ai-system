import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

// Draft-only mode (no third-party publisher): "approve" marks the draft as
// published/ready-to-copy. Staff manually copy the post text from the dashboard
// and post to their socials. See lib/services/social.ts header for context.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { postId, action, note } = body as { postId: string; action: "approve" | "reject"; note?: string };

  if (!postId || !action) {
    return NextResponse.json({ error: "postId and action required" }, { status: 400 });
  }

  if (action === "approve") {
    await prisma.socialPost.update({
      where: { id: postId },
      data: {
        approvalStatus: "approved",
        status: "published",
        publishedAt: new Date(),
        reviewNote: note ?? null,
      },
    });
    return NextResponse.json({ approved: true });
  }

  if (action === "reject") {
    await prisma.socialPost.update({
      where: { id: postId },
      data: { approvalStatus: "rejected", status: "draft", reviewNote: note ?? null },
    });
    return NextResponse.json({ rejected: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

export async function GET() {
  const pending = await prisma.socialPost.findMany({
    where: { approvalStatus: "pending_review" },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ posts: pending });
}
