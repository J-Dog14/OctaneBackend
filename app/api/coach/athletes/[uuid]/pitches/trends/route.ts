import { cachedCoachData } from "@/lib/coach/cache";
import { NextRequest } from "next/server";
import { internalError, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { getPitchTrends } from "@/lib/coach/pitchLog";
import { apiErrorMessage } from "@/lib/pitch-intel/errors";

export const dynamic = "force-dynamic";

/** GET /api/coach/athletes/:uuid/pitches/trends — per-session, per-pitch-type averages of every metric. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  try {
    return success({ points: await cachedCoachData(request, ["pitch-trends", uuid], () => getPitchTrends(uuid)) });
  } catch (error) {
    console.error("Error in GET /api/coach/athletes/[uuid]/pitches/trends:", error);
    return internalError(apiErrorMessage(error, "Failed to load trends"));
  }
}
