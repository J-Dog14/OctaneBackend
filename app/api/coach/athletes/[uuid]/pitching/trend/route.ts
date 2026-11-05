import { NextRequest } from "next/server";
import { internalError, notFound, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { cachedCoachData } from "@/lib/coach/cache";
import { getCoachPitching } from "@/lib/coach/pitching";
import { gradeTrend } from "@/lib/coach/pitchXa";
import { apiErrorMessage } from "@/lib/pitch-intel/errors";

export const dynamic = "force-dynamic";

/** GET /api/coach/athletes/:uuid/pitching/trend?season=2026 — xArsenal by outing (Savant games + Trackman sessions). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  const s = Number(request.nextUrl.searchParams.get("season"));
  const season = Number.isInteger(s) && s > 1900 ? s : null;
  try {
    const data = await cachedCoachData(request, ["pitching", uuid], () => getCoachPitching(uuid));
    if (!data) return notFound("Athlete not found");
    return success(await cachedCoachData(request, ["pitching-trend", uuid, season], () => gradeTrend(data, season)));
  } catch (error) {
    console.error("Error in GET /api/coach/athletes/[uuid]/pitching/trend:", error);
    return internalError(apiErrorMessage(error, "Could not load grades by outing"));
  }
}
