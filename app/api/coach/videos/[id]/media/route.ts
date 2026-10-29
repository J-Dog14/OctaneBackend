import { NextResponse } from "next/server";
import { noStore, videoRoute, type IdParams } from "@/lib/videos/http";
import { mediaUrl } from "@/lib/videos/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/coach/videos/:id/media[?download=1]: after the coach check, redirect to a
 * one-hour presigned R2 URL. R2 serves the bytes (range requests / seeking included),
 * so playback never streams through Railway and the bucket stays private.
 */
export const GET = videoRoute<IdParams>(async (req, { params }) => {
  const { id } = await params;
  const download = new URL(req.url).searchParams.has("download");
  const url = await mediaUrl(id, download);
  return NextResponse.redirect(url, { status: 302, headers: noStore });
});
