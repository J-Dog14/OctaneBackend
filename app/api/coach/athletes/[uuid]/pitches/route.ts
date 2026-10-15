import { cachedCoachData } from "@/lib/coach/cache";
import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { getPitchLog, parsePitchQuery } from "@/lib/coach/pitchLog";
import { apiErrorMessage } from "@/lib/pitch-intel/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/coach/athletes/:uuid/pitches?session=KEY
 * GET /api/coach/athletes/:uuid/pitches?from=YYYY-MM-DD&to=YYYY-MM-DD&kinds=game,bullpen&sources=trackman,savant
 * Pitch-by-pitch rows (Trackman + Savant) for the coach pitch report.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  const q = parsePitchQuery(request.nextUrl.searchParams);
  if (typeof q === "string") return badRequest(q);
  try {
    return success(await cachedCoachData(request, ["pitches", uuid, q], () => getPitchLog(uuid, q)));
  } catch (error) {
    console.error("Error in GET /api/coach/athletes/[uuid]/pitches:", error);
    return internalError(apiErrorMessage(error, "Failed to load pitches"));
  }
}
