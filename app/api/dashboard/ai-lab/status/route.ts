import { NextRequest } from "next/server";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { requireRole } from "@/lib/auth/requireAuth";
import { getAiLabConfig } from "@/lib/ai-lab/config";
import { runAiJson } from "@/lib/ai-lab/exec";
import { badRequest, internalError, success } from "@/lib/responses";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Newest file in a folder — the nightly jobs write one dated log per run. */
async function newestLog(dir: string): Promise<{ file: string; at: string } | null> {
  try {
    const names = await readdir(dir);
    let best: { file: string; ms: number } | null = null;
    for (const n of names) {
      const st = await stat(path.join(dir, n));
      if (st.isFile() && (!best || st.mtimeMs > best.ms)) best = { file: n, ms: st.mtimeMs };
    }
    return best ? { file: best.file, at: new Date(best.ms).toISOString() } : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/dashboard/ai-lab/status?athleteUuid=…
 * The athlete's pipeline checklist (from `wb status --json`) plus when the
 * nightly Proteus / mobility / workbench jobs last ran on this machine.
 */
export async function GET(request: NextRequest) {
  await requireRole("admin");
  const uuid = new URL(request.url).searchParams.get("athleteUuid") ?? "";
  if (!UUID.test(uuid)) return badRequest("athleteUuid must be a UUID");
  try {
    const cfg = await getAiLabConfig();
    const [status, proteus, mobility] = await Promise.all([
      runAiJson<Record<string, unknown>>(["wb", "status", uuid, "--json"], 120_000),
      newestLog(path.join(cfg.uaisRoot, "python", "proteus", "logs")),
      newestLog(path.join(cfg.uaisRoot, "python", "mobility", "logs")),
    ]);
    let workbench: { at: string } | null = null;
    if (cfg.outputsDir) {
      try {
        const st = await stat(path.join(cfg.outputsDir, "workbench", "nightly.log"));
        workbench = { at: new Date(st.mtimeMs).toISOString() };
      } catch {
        workbench = null;
      }
    }
    return success({ ...status, nightly: { proteus, mobility, workbench } });
  } catch (e) {
    return internalError(e instanceof Error ? e.message : "status failed");
  }
}
