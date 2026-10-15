import { cachedCoachData } from "@/lib/coach/cache";
import { internalError, notFound, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { buildMobilityHistory } from "@/lib/coach/mobility";

export const dynamic = "force-dynamic";

/** GET /api/coach/athletes/:uuid/mobility — every mobility session with component and category percentiles. */
export async function GET(request: Request, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  try {
    const history = await cachedCoachData(request, ["mobility", uuid], () => buildMobilityHistory(uuid));
    return history ? success(history) : notFound("No mobility assessments for this athlete");
  } catch (error) {
    console.error("Error in GET /api/coach/athletes/[uuid]/mobility:", error);
    return internalError("Failed to build the mobility history");
  }
}
