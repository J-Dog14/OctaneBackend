import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { getUaisRunner } from "@/lib/uais/runners";
import { createJob } from "@/lib/uais/runJob";

/**
 * POST /api/dashboard/uais/run
 * Body: { runnerId: string, athleteUuid?: string, uploadedFileKeys?: string[] }
 * Starts the UAIS process for that runner. When uploadedFileKeys is set, files are
 * downloaded from R2 to a temp dir and the data-dir env var is set before spawning.
 * Returns jobId; client should then fetch GET /api/dashboard/uais/stream?jobId=...
 */
export async function POST(request: NextRequest) {
  try {
    let body: { runnerId?: string; athleteUuid?: string | null; uploadedFileKeys?: string[] };
    try {
      body = await request.json();
    } catch {
      return badRequest("JSON body required");
    }
    const runnerId = body.runnerId;
    if (!runnerId || typeof runnerId !== "string") {
      return badRequest("runnerId is required");
    }
    const runner = getUaisRunner(runnerId);
    if (!runner) {
      return badRequest("Unknown or unconfigured runner. Set the runner's CWD env var.");
    }
    const athleteUuid = body.athleteUuid ?? null;
    const uploadedFileKeys = Array.isArray(body.uploadedFileKeys) ? body.uploadedFileKeys : undefined;
    const jobId = createJob(runner, { athleteUuid: athleteUuid ?? undefined, uploadedFileKeys });
    return success({ jobId });
  } catch (error) {
    console.error("Error in POST /api/dashboard/uais/run:", error);
    return internalError("Failed to start UAIS process");
  }
}
