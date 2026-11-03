import { cachedCoachData } from "@/lib/coach/cache";
import { NextRequest } from "next/server";
import { badRequest, internalError, notFound, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { buildArmFlight } from "@/lib/coach/armFlight/load";

export const dynamic = "force-dynamic";

/**
 * GET /api/coach/athletes/:uuid/pitch-sync/arm?date=YYYY-MM-DD
 * Throwing-arm markers from MER through release for each 3D trial, placed on the field with the
 * session's 3D ↔ TrackMan release fit, plus each paired pitch's flight path.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  const date = new URL(request.url).searchParams.get("date");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest("date must be YYYY-MM-DD");
  try {
    const data = await cachedCoachData(request, ["pitch-sync-arm", uuid, date || null], () => buildArmFlight(uuid, date));
    return data ? success(data) : notFound("No 3D captures paired with TrackMan for this athlete");
  } catch (error) {
    console.error("Error in GET /api/coach/athletes/[uuid]/pitch-sync/arm:", error);
    return internalError("Failed to load arm + flight");
  }
}
