import { cachedCoachData } from "@/lib/coach/cache";
import { internalError, notFound, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { buildProgramHistory } from "@/lib/coach/program";

export const dynamic = "force-dynamic";

/** GET /api/coach/athletes/:uuid/program — 8ctane app programs and the exercise log (App DB snapshot). */
export async function GET(request: Request, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  try {
    const history = await cachedCoachData(request, ["program", uuid], () => buildProgramHistory(uuid));
    return history ? success(history) : notFound("Athlete not found");
  } catch (error) {
    console.error("Error in GET /api/coach/athletes/[uuid]/program:", error);
    return internalError("Failed to load program data");
  }
}
