import { cachedCoachData } from "@/lib/coach/cache";
import { NextRequest } from "next/server";
import { internalError, notFound, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { getCoachPitching } from "@/lib/coach/pitching";
import { apiErrorMessage } from "@/lib/pitch-intel/errors";

export const dynamic = "force-dynamic";

/** GET /api/coach/athletes/:uuid/pitching — Savant seasons/games, Trackman sessions, reports, velo series. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  try {
    const data = await cachedCoachData(request, ["pitching", uuid], () => getCoachPitching(uuid));
    return data ? success(data) : notFound("Athlete not found");
  } catch (error) {
    console.error("Error in GET /api/coach/athletes/[uuid]/pitching:", error);
    return internalError(apiErrorMessage(error, "Failed to load pitch data"));
  }
}
