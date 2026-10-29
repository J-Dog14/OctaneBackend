import { NextResponse } from "next/server";
import { videoRoute, type IdParams } from "@/lib/videos/http";
import { isUuid } from "@/lib/videos/rules";
import { cancelUpload } from "@/lib/videos/service";

/** POST /api/coach/videos/:id/cancel: drop a pending upload (no-op once it's saved). */
export const POST = videoRoute<IdParams>(async (_req, { params }, actor) => {
  const { id } = await params;
  if (isUuid(id)) await cancelUpload(id, actor);
  return NextResponse.json({ ok: true });
});
