"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Wand2, Send, Video, CheckCircle, XCircle, Clock } from "lucide-react";

interface SocialPost {
  id: string;
  platform: string;
  content: string;
  status: string;
  approvalStatus: string | null;
  imageUrl: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  engagements: number;
  reach: number;
  createdAt: string;
}

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  instagram: <span className="text-xs font-bold">IG</span>,
  linkedin: <span className="text-xs font-bold">LI</span>,
  tiktok: <Video className="w-3 h-3" />,
  facebook: <span className="text-xs font-bold">FB</span>,
};

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-pink-100 text-pink-800",
  linkedin: "bg-blue-100 text-blue-800",
  tiktok: "bg-slate-100 text-slate-800",
  facebook: "bg-indigo-100 text-indigo-800",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  scheduled: "bg-yellow-100 text-yellow-800",
  published: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

export default function SocialPage() {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [pendingReviewPosts, setPendingReviewPosts] = useState<SocialPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const fetchPosts = useCallback(async () => {
    const params = new URLSearchParams();
    if (platformFilter !== "all") params.set("platform", platformFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);

    const [postsResponse, reviewResponse] = await Promise.all([
      fetch(`/api/social?${params}`),
      fetch("/api/social/approve"),
    ]);

    const postsData = await postsResponse.json();
    const reviewData = await reviewResponse.json();

    setPosts(postsData.posts);
    setPendingReviewPosts(reviewData.posts ?? []);
    setIsLoading(false);
  }, [platformFilter, statusFilter]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    await fetch("/api/social", { method: "POST" });
    await fetchPosts();
    setIsGenerating(false);
  };

  const handlePublishDue = async () => {
    setIsPublishing(true);
    await fetch("/api/social", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish" }),
    });
    await fetchPosts();
    setIsPublishing(false);
  };

  const handleApprove = async (postId: string) => {
    setApprovingId(postId);
    await fetch("/api/social/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", postId }),
    });
    await fetchPosts();
    setApprovingId(null);
  };

  const handleReject = async (postId: string) => {
    setRejectingId(postId);
    await fetch("/api/social/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", postId }),
    });
    await fetchPosts();
    setRejectingId(null);
  };

  const platformStats = ["instagram", "linkedin", "tiktok", "facebook"].map((platform) => {
    const platformPosts = posts.filter((p) => p.platform === platform);
    const published = platformPosts.filter((p) => p.status === "published");
    return {
      platform,
      total: platformPosts.length,
      published: published.length,
      totalReach: published.reduce((sum, p) => sum + p.reach, 0),
    };
  });

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Social Content</h1>
          <p className="text-muted-foreground text-sm mt-1">
            AI-generated posts across Instagram, LinkedIn, TikTok, and Facebook
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handlePublishDue} disabled={isPublishing} variant="outline">
            {isPublishing ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Publishing...</>
            ) : (
              <><Send className="w-4 h-4 mr-2" />Publish Due</>
            )}
          </Button>
          <Button onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Generating...</>
            ) : (
              <><Wand2 className="w-4 h-4 mr-2" />Generate Posts</>
            )}
          </Button>
        </div>
      </div>

      {pendingReviewPosts.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-900">
              <Clock className="w-4 h-4" />
              Pending Review ({pendingReviewPosts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {pendingReviewPosts.map((post) => (
                <div key={post.id} className="bg-white border border-amber-200 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${PLATFORM_COLORS[post.platform]}`}>
                          {PLATFORM_ICONS[post.platform]}
                          {post.platform.charAt(0).toUpperCase() + post.platform.slice(1)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(post.createdAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed text-gray-800">{post.content}</p>
                      {post.imageUrl && (
                        <p className="text-xs text-muted-foreground mt-2">Image attached</p>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-700 hover:bg-red-50"
                        disabled={rejectingId === post.id}
                        onClick={() => handleReject(post.id)}
                      >
                        {rejectingId === post.id
                          ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          : <XCircle className="w-3.5 h-3.5 mr-1" />}
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                        disabled={approvingId === post.id}
                        onClick={() => handleApprove(post.id)}
                      >
                        {approvingId === post.id
                          ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          : <CheckCircle className="w-3.5 h-3.5 mr-1" />}
                        Approve & Schedule
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-4 gap-4">
        {platformStats.map(({ platform, total, published, totalReach }) => (
          <Card key={platform}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${PLATFORM_COLORS[platform]}`}>
                  {PLATFORM_ICONS[platform]}
                  {platform.charAt(0).toUpperCase() + platform.slice(1)}
                </span>
              </div>
              <p className="text-2xl font-bold">{total}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {published} published · {totalReach.toLocaleString()} reach
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Content Feed</CardTitle>
            <div className="flex gap-2">
              <Select value={platformFilter} onValueChange={(v) => setPlatformFilter(v ?? "all")}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All platforms</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="linkedin">LinkedIn</SelectItem>
                  <SelectItem value="tiktok">TikTok</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-12">
              <Wand2 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No posts yet. Click &ldquo;Generate Posts&rdquo; to create content from recent planning applications.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {posts.map((post) => (
                <div key={post.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${PLATFORM_COLORS[post.platform]}`}>
                      {PLATFORM_ICONS[post.platform]}
                      {post.platform.charAt(0).toUpperCase() + post.platform.slice(1)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {post.approvalStatus === "pending_review" && (
                        <Badge className="text-xs bg-amber-100 text-amber-800" variant="outline">review</Badge>
                      )}
                      <Badge className={`text-xs ${STATUS_COLORS[post.status] ?? "bg-gray-100 text-gray-700"}`} variant="outline">
                        {post.status}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed">{post.content}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    {post.status === "published" ? (
                      <span>{post.reach.toLocaleString()} reach · {post.engagements} engagements</span>
                    ) : post.scheduledAt ? (
                      <span>Scheduled: {new Date(post.scheduledAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</span>
                    ) : (
                      <span>Draft</span>
                    )}
                    <span>{new Date(post.createdAt).toLocaleDateString("en-GB")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
