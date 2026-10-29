import { NextResponse } from "next/server";
import { jsonBody, noStore, videoRoute, type IdParams } from "@/lib/videos/http";
import { parseEditInput } from "@/lib/videos/rules";
import { deleteVideo, editVideo, getVideo } from "@/lib/videos/service";

export const GET = videoRoute<IdParams>(async (_req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await getVideo(id), { headers: noStore });
});

/** PATCH: edit title / notes / recorded date / discipline. */
export const PATCH = videoRoute<IdParams>(async (req, { params }, actor) => {
  const { id } = await params;
  const parsed = parseEditInput(await jsonBody(req));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  return NextResponse.json(await editVideo(id, parsed.value, actor), { headers: noStore });
});

/** DELETE: remove one clip (and its file). Athletes can't be deleted from here. */
export const DELETE = videoRoute<IdParams>(async (_req, { params }, actor) => {
  const { id } = await params;
  await deleteVideo(id, actor);
  return NextResponse.json({ ok: true });
});
