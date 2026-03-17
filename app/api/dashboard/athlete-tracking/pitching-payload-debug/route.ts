import { NextRequest } from "next/server";
import { badRequest, notFound, success } from "@/lib/responses";
import { requireAuth } from "@/lib/auth/requireAuth";
import {
  getPitchingTrialValueMapAndAthlete,
  buildPitchingPayloadWithDebug,
} from "@/lib/octane/pitchingPayload";

/**
 * GET ?athleteUuid=... — Returns pitching payload plus debug info: for each metric,
 * the resolved key (metric name pulled from the trials JSON), component (X/Y/Z), and value.
 * Also returns all keys present in the trials metrics JSON so you can verify naming.
 */
export async function GET(request: NextRequest) {
  await requireAuth();
  const athleteUuid = request.nextUrl.searchParams.get("athleteUuid");
  if (!athleteUuid?.trim()) {
    return badRequest("athleteUuid is required");
  }

  const result = await getPitchingTrialValueMapAndAthlete(athleteUuid.trim());
  if (!result) {
    return notFound("No pitching trial data found for athlete");
  }

  const { payload, debug } = buildPitchingPayloadWithDebug(
    result.valueByMetricName,
    result.athlete
  );

  const allKeys = Array.from(result.valueByMetricName.keys()).sort();

  return success({
    payload: { ...payload, sessionDate: result.sessionDate },
    debug,
    /** All keys present in the trials metrics JSON (for verifying naming). */
    allKeysInTrialsJson: allKeys,
  });
}
