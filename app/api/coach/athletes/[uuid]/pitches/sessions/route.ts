import { cachedCoachData } from "@/lib/coach/cache";
import { NextRequest } from "next/server";
import { internalError, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { getPitchSessions } from "@/lib/coach/pitchLog";
import { apiErrorMessage } from "@/lib/pitch-intel/errors";

export const dynamic = "force-dynamic";

/** GET /api/coach/athletes/:uuid/pitches/sessions — every Trackman session and Savant game, newest first. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  try {
    return success({ sessions: await cachedCoachData(request, ["pitch-sessions", uuid], () => getPitchSessions(uuid)) });
  } catch (error) {
    console.error("Error in GET /api/coach/athletes/[uuid]/pitches/sessions:", error);
    return internalError(apiErrorMessage(error, "Failed to load sessions"));
  }
}
