import { cachedCoachData } from "@/lib/coach/cache";
import { internalError, notFound, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { buildThrowingHistory } from "@/lib/coach/programThrowing";

export const dynamic = "force-dynamic";

/** GET /api/coach/athletes/:uuid/program-throwing — plyo routines and throwing activities per program day. */
export async function GET(request: Request, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  try {
    const history = await cachedCoachData(request, ["program-throwing", uuid], () => buildThrowingHistory(uuid));
    return history ? success(history) : notFound("Athlete not found");
  } catch (error) {
    console.error("Error in GET /api/coach/athletes/[uuid]/program-throwing:", error);
    return internalError("Failed to load the throwing program");
  }
}
