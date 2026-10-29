import { NextResponse } from "next/server";
import { jsonBody, noStore, videoRoute, type IdParams } from "@/lib/videos/http";
import { isUuid, parseIdList } from "@/lib/videos/rules";
import { completeUpload } from "@/lib/videos/service";

/** POST /api/coach/videos/:id/complete: the browser finished its PUT; verify and publish. */
export const POST = videoRoute<IdParams>(async (req, { params }, actor) => {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  const body = (await jsonBody(req).catch(() => ({}))) as { confirmReplaceIds?: unknown };
  const confirm = parseIdList(body?.confirmReplaceIds);
  if (!confirm) return NextResponse.json({ error: "Invalid replacement choice." }, { status: 400 });
  return NextResponse.json(await completeUpload(id, actor, confirm), { headers: noStore });
});
