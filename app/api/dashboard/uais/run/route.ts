import { NextRequest } from "next/server";
import path from "node:path";
import os from "node:os";
import { badRequest, internalError, success } from "@/lib/responses";
import { getUaisRunner, getRunnersFromSettings } from "@/lib/uais/runners";
import { createJob, ASSESSMENT_DATA_DIR_ENV } from "@/lib/uais/runJob";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/requireAuth";

/**
 * Maps runner ID → env var(s) each script reads for its report output directory.
 * Single-element arrays: that one var is set to reportDir.
 * For Athletic Screen the script writes to GOOGLE_DRIVE first then shutil.copy2 to DIR —
 * they MUST be different paths or shutil raises SameFileError, so we use a subdirectory.
 */
const REPORT_DIR_ENV: Record<string, string[]> = {
  // Athletic Screen writes primary report to GOOGLE_DRIVE, then copies to DIR.
  // Keep them separate so shutil.copy2 doesn't raise SameFileError.
  // emitReportLinks scans the primary dir (GOOGLE_DRIVE = reportDir).
  "athletic-screen":  ["ATHLETIC_SCREEN_REPORTS_GOOGLE_DRIVE"],
  "readiness-screen": ["READINESS_SCREEN_REPORTS_DIR"],
  "pro-sup":          ["PRO_SUP_REPORTS_DIR"],
  "arm-action":       ["ARM_ACTION_REPORTS_DIR"],
  "curveball":        ["CURVEBALL_REPORTS_DIR"],
  "mobility":         ["MOBILITY_REPORTS_DIR"],
  "pitching":         ["PITCHING_REPORTS_DIR"],
  "hitting":          ["HITTING_REPORTS_DIR"],
};

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
    let body: { runnerId?: string; athleteUuid?: string | null; uploadedFileKeys?: string[]; reportOnly?: boolean; sessionDate?: string | null };
    try {
      body = await request.json();
    } catch {
      return badRequest("JSON body required");
    }
    const runnerId = body.runnerId;
    if (!runnerId || typeof runnerId !== "string") {
      return badRequest("runnerId is required");
    }
    // Priority 1: DB Settings — always consulted first for both runner resolution
    // and data-dir env var injection.
    const extraEnv: Record<string, string> = {};
    let settingsMap: Record<string, string> = {};
    let runner = null;
    try {
      const rows = await prisma.orgSetting.findMany();
      settingsMap = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      if (settingsMap.uais_warehouse_db_url) extraEnv.WAREHOUSE_DATABASE_URL = settingsMap.uais_warehouse_db_url;
      const dataDirKey = `uais_data_dir_${runnerId.replace(/-/g, "_")}`;
      const dataDirEnvVar = ASSESSMENT_DATA_DIR_ENV[runnerId];
      if (settingsMap[dataDirKey] && dataDirEnvVar) extraEnv[dataDirEnvVar] = settingsMap[dataDirKey];
      const settingsRunners = getRunnersFromSettings(settingsMap);
      runner = settingsRunners.find((r) => r.id === runnerId) ?? null;
    } catch {
      // Non-fatal: fall through to env/config
    }

    // Priority 2: env vars / config file (local dev or self-hosted without DB config).
    if (!runner) {
      runner = getUaisRunner(runnerId);
    }

    if (!runner) {
      return badRequest("Unknown or unconfigured runner. Set the runner's CWD env var.");
    }
    if (body.reportOnly) {
      runner = { ...runner, command: runner.command + " --report-only" };
    }
    const sessionDate = typeof body.sessionDate === "string" ? body.sessionDate.trim() : null;
    if (sessionDate && /^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
      extraEnv.SESSION_DATE = sessionDate;
    }
    const athleteUuid = body.athleteUuid ?? null;
    const uploadedFileKeys = Array.isArray(body.uploadedFileKeys) ? body.uploadedFileKeys : undefined;

    // Determine report output directory (Settings → temp default) and inject env vars
    const reportDirKey = `uais_report_dir_${runnerId.replace(/-/g, "_")}`;
    const reportDir = settingsMap[reportDirKey]?.trim()
      || path.join(os.tmpdir(), "uais-reports", runnerId);
    for (const envVar of REPORT_DIR_ENV[runnerId] ?? []) {
      extraEnv[envVar] = reportDir;
    }
    // Athletic Screen writes primary → GOOGLE_DRIVE, then copies to DIR.
    // Set DIR to a sibling path so shutil.copy2 doesn't get SameFileError.
    if (runnerId === "athletic-screen") {
      extraEnv["ATHLETIC_SCREEN_REPORTS_DIR"] = path.join(os.tmpdir(), "uais-reports", "athletic-screen-local");
    }

    const jobId = createJob(runner, { athleteUuid: athleteUuid ?? undefined, uploadedFileKeys, extraEnv, reportDir });
    return success({ jobId });
  } catch (error) {
    console.error("Error in POST /api/dashboard/uais/run:", error);
    return internalError("Failed to start UAIS process");
  }
}
