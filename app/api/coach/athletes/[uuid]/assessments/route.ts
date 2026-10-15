import { NextRequest } from "next/server";
import { cachedCoachData } from "@/lib/coach/cache";
import { badRequest, internalError, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { getCurveballHistory, getProSupHistory } from "@/lib/coach/summary";

export const dynamic = "force-dynamic";

/** GET /api/coach/athletes/:uuid/assessments — pro-sup and curveball test history (newest first). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  const kind = request.nextUrl.searchParams.get("kind");
  if (kind && kind !== "prosup" && kind !== "curveball") return badRequest("Unknown assessment kind");
  try {
    const history = await cachedCoachData(request, ["assessments", uuid, kind], async () => {
      const [proSup, curveball] = await Promise.all([
        kind !== "curveball" ? getProSupHistory(uuid) : [],
        kind !== "prosup" ? getCurveballHistory(uuid) : [],
      ]);
      return { proSup, curveball };
    });
    return success(history);
  } catch (error) {
    console.error("Error in GET /api/coach/athletes/[uuid]/assessments:", error);
    return internalError("Failed to load assessments");
  }
}
