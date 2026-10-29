import { NextResponse } from "next/server";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { jsonBody, noStore, videoRoute } from "@/lib/videos/http";
import { parseUploadInput } from "@/lib/videos/rules";
import { startUpload } from "@/lib/videos/service";

/**
 * POST /api/coach/videos/uploads: start an upload. Body: { clientKey, athleteUuid, category, title,
 * notes, recordedDate, filename, mime, size, confirmReplaceIds? }. Returns a presigned PUT URL.
 * 409 REPLACE_REQUIRED (with `replaces`) when the athlete is at the cap and the coach hasn't
 * confirmed which clip rotates out; resend with confirmReplaceIds.
 */
export const POST = videoRoute(async (req, _ctx, actor) => {
  const parsed = parseUploadInput(await jsonBody(req));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const denied = await requireCoachForAthlete(parsed.value.athleteUuid);
  if (denied) return denied;
  const result = await startUpload(parsed.value, actor);
  return NextResponse.json(result, { status: result.status === "ready" ? 200 : 201, headers: noStore });
});
