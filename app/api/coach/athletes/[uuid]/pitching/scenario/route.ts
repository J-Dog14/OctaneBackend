import { NextRequest } from "next/server";
import { badRequest, internalError, notFound, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { cachedCoachData } from "@/lib/coach/cache";
import { getCoachPitching } from "@/lib/coach/pitching";
import { gradeScenario, parseScenario, ScenarioError } from "@/lib/coach/pitchXa";
import { apiErrorMessage } from "@/lib/pitch-intel/errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/coach/athletes/:uuid/pitching/scenario — Add Pitches sandbox (Ryan's handoff 06).
 * Body: { snapshot: "season:2026" | "tm:DATE:TYPE" | "rep:ID", adds: [{ code, velo, ivb, arm, spin?, vaa?, usage? }], drop: ["SL"] }
 * Grades shape only; nothing is saved.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  let req;
  try {
    req = parseScenario(await request.json().catch(() => null));
  } catch (error) {
    return badRequest(error instanceof ScenarioError ? error.message : "Bad request");
  }
  try {
    const data = await cachedCoachData(request, ["pitching", uuid], () => getCoachPitching(uuid));
    if (!data) return notFound("Athlete not found");
    return success(await gradeScenario(data, req));
  } catch (error) {
    if (error instanceof ScenarioError) return badRequest(error.message);
    console.error("Error in POST /api/coach/athletes/[uuid]/pitching/scenario:", error);
    return internalError(apiErrorMessage(error, "Could not grade this arsenal"));
  }
}
