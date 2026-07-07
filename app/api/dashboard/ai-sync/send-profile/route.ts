import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/requireAuth";
import { sendAiProfile } from "@/lib/octane/aiLayerSync";
import { badRequest, internalError, success } from "@/lib/responses";

/** Push the athlete's latest AI profile to Octane (/api/biomech/profile). */
export async function POST(request: NextRequest) {
  await requireRole("admin");
  try {
    const { athleteUuid } = (await request.json()) as { athleteUuid?: unknown };
    if (!athleteUuid || typeof athleteUuid !== "string") {
      return badRequest("athleteUuid is required");
    }

    const result = await sendAiProfile(athleteUuid);
    if (!result.ok) return badRequest(result.error);
    return success(result);
  } catch (err) {
    console.error("ai-sync send-profile failed:", err);
    return internalError(err instanceof Error ? err.message : "Unknown error");
  }
}
