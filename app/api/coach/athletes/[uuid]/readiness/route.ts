import { cachedCoachData } from "@/lib/coach/cache";
import { NextRequest } from "next/server";
import { internalError, notFound, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { buildReadinessPayload } from "@/lib/dashboard/readinessPayload";

export const dynamic = "force-dynamic";

/** GET /api/coach/athletes/:uuid/readiness — same payload as the Readiness Screen page. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  try {
    return success(await cachedCoachData(request, ["readiness", uuid], () => buildReadinessPayload(uuid)));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("not found")) return notFound(msg);
    console.error("Error in GET /api/coach/athletes/[uuid]/readiness:", error);
    return internalError("Failed to load readiness data");
  }
}
