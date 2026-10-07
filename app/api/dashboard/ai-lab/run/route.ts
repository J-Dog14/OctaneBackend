import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/requireAuth";
import { ACTIONS_BY_ID, validateParams } from "@/lib/ai-lab/actions";
import { aiLayerEnv, getAiLabConfig } from "@/lib/ai-lab/config";
import { createArgvJob } from "@/lib/uais/runJob";
import { badRequest, internalError, success } from "@/lib/responses";

/**
 * POST /api/dashboard/ai-lab/run
 * Body: { actionId: string, params: Record<string, unknown> }
 * Validates params against the action's declared kinds, spawns it without a
 * shell and returns { jobId }. Stream with GET /api/dashboard/uais/stream.
 */
export async function POST(request: NextRequest) {
  await requireRole("admin");
  let body: { actionId?: unknown; params?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest("JSON body required");
  }
  const action = typeof body.actionId === "string" ? ACTIONS_BY_ID.get(body.actionId) : undefined;
  if (!action) return badRequest("Unknown actionId");
  const rawParams =
    body.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? (body.params as Record<string, unknown>)
      : {};

  let values;
  try {
    values = validateParams(action, rawParams);
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Invalid parameters");
  }

  try {
    const cfg = await getAiLabConfig();
    if (action.target === "uais") {
      if (!cfg.uaisPython) return badRequest("UAIS venv python not found (uais/venv).");
      // Same environment the UAIS maintenance runners get, plus the settings
      // the nightly .bat files would otherwise supply.
      const extra: Record<string, string> = { AUTOMATED_RUN: "1", PROTEUS_HEADLESS: "true", PYTHONIOENCODING: "utf-8" };
      const s = cfg.settings;
      if (s.uais_warehouse_db_url) extra.WAREHOUSE_DATABASE_URL = s.uais_warehouse_db_url;
      if (s.proteus_email) extra.PROTEUS_EMAIL = s.proteus_email;
      if (s.proteus_password) extra.PROTEUS_PASSWORD = s.proteus_password;
      if (s.proteus_location) extra.PROTEUS_LOCATION = s.proteus_location;
      const jobId = createArgvJob(
        { id: `ai-lab:${action.id}`, label: action.label, cwd: cfg.uaisRoot },
        cfg.uaisPython,
        action.build(values),
        { env: { ...process.env, ...extra } }
      );
      return success({ jobId, label: action.label });
    }

    if (!cfg.root || !cfg.python) return badRequest(cfg.problems.join(" "));
    const jobId = createArgvJob(
      { id: `ai-lab:${action.id}`, label: action.label, cwd: cfg.root },
      cfg.python,
      action.build(values),
      { env: aiLayerEnv(), artifactRoot: cfg.outputsDir ?? undefined }
    );
    return success({ jobId, label: action.label });
  } catch (e) {
    console.error("ai-lab run failed:", e);
    return internalError(e instanceof Error ? e.message : "Failed to start job");
  }
}
