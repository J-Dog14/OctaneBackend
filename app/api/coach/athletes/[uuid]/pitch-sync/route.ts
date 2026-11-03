import { cachedCoachData } from "@/lib/coach/cache";
import { NextRequest } from "next/server";
import { badRequest, internalError, notFound, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { buildPitchSync } from "@/lib/coach/pitchSync";

export const dynamic = "force-dynamic";

/**
 * GET /api/coach/athletes/:uuid/pitch-sync?date=YYYY-MM-DD
 * "TM + 3D" tab: the session's 3D trials with their paired TrackMan pitches (latest paired session by default).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  const date = new URL(request.url).searchParams.get("date");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest("date must be YYYY-MM-DD");
  try {
    const data = await cachedCoachData(request, ["pitch-sync", uuid, date || null], () => buildPitchSync(uuid, date));
    return data ? success(data) : notFound("No 3D captures paired with TrackMan for this athlete");
  } catch (error) {
    console.error("Error in GET /api/coach/athletes/[uuid]/pitch-sync:", error);
    return internalError("Failed to load mechanics + flight");
  }
}
