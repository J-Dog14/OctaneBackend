import { requireRole } from "@/lib/auth/requireAuth";
import { runAiJson } from "@/lib/ai-lab/exec";
import { internalError, success } from "@/lib/responses";

/** GET /api/dashboard/ai-lab/queue — every queued packet and its state. */
export async function GET() {
  await requireRole("admin");
  try {
    const entries = await runAiJson<unknown[]>(["wb", "queue", "list", "--json"], 60_000);
    return success({ entries });
  } catch (e) {
    return internalError(e instanceof Error ? e.message : "queue failed");
  }
}
