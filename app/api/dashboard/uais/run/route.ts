import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { getUaisRunner, getRunnersFromSettings } from "@/lib/uais/runners";
import { createJob, ASSESSMENT_DATA_DIR_ENV } from "@/lib/uais/runJob";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/requireAuth";

/**
 * POST /api/dashboard/uais/run
 * Body: { runnerId: string, athleteUuid?: string, uploadedFileKeys?: string[], reportOnly?: boolean }
 * Starts the UAIS process for that runner. When uploadedFileKeys is set, files are
 * downloaded from R2 to a temp dir and the data-dir env var is set before spawning.
 * When reportOnly is true, "--report-only" is appended to the runner's command.
 * Returns jobId; client should then fetch GET /api/dashboard/uais/stream?jobId=...
 */
export async function POST(request: NextRequest) {
  await requireRole("admin");
  try {
    let body: { runnerId?: string; athleteUuid?: string | null; uploadedFileKeys?: string[]; reportOnly?: boolean };
    try {
      body = await request.json();
    } catch {
      return badRequest("JSON body required");
    }
    const runnerId = body.runnerId;
    if (!runnerId || typeof runnerId !== "string") {
      return badRequest("runnerId is required");
    }
    let runner = getUaisRunner(runnerId);

    // Build extra env vars from org settings (warehouse DB URL + per-runner data dir).
    // Also used as fallback to resolve runner when no env/config is present.
    const extraEnv: Record<string, string> = {};
    let settingsMap: Record<string, string> = {};
    try {
      const rows = await prisma.orgSetting.findMany();
      settingsMap = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      if (settingsMap.uais_warehouse_db_url) extraEnv.WAREHOUSE_DATABASE_URL = settingsMap.uais_warehouse_db_url;
      const dataDirKey = `uais_data_dir_${runnerId.replace(/-/g, "_")}`;
      const dataDirEnvVar = ASSESSMENT_DATA_DIR_ENV[runnerId];
      if (settingsMap[dataDirKey] && dataDirEnvVar) extraEnv[dataDirEnvVar] = settingsMap[dataDirKey];
    } catch {
      // Non-fatal: proceed without settings-injected env vars
    }

    // Fallback: resolve runner from DB settings when not found via env/config.
    if (!runner) {
      const settingsRunners = getRunnersFromSettings(settingsMap);
      runner = settingsRunners.find((r) => r.id === runnerId) ?? null;
    }

    if (!runner) {
      return badRequest("Unknown or unconfigured runner. Set the runner's CWD env var.");
    }
    if (body.reportOnly) {
      runner = { ...runner, command: runner.command + " --report-only" };
    }
    const athleteUuid = body.athleteUuid ?? null;
    const uploadedFileKeys = Array.isArray(body.uploadedFileKeys) ? body.uploadedFileKeys : undefined;

    const jobId = createJob(runner, { athleteUuid: athleteUuid ?? undefined, uploadedFileKeys, extraEnv });
    return success({ jobId });
  } catch (error) {
    console.error("Error in POST /api/dashboard/uais/run:", error);
    return internalError("Failed to start UAIS process");
  }
}
