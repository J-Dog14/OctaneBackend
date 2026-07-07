import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/requireAuth";
import { getLatestAiProfile } from "@/lib/octane/aiLayerSync";
import { badRequest, internalError, success } from "@/lib/responses";

/** Does this athlete have an AI profile in the warehouse? (GET ?athleteUuid=) */
export async function GET(request: NextRequest) {
  await requireRole("admin");
  try {
    const athleteUuid = request.nextUrl.searchParams.get("athleteUuid");
    if (!athleteUuid) return badRequest("athleteUuid is required");

    const status = await getLatestAiProfile(athleteUuid);
    return success(status);
  } catch (err) {
    console.error("ai-sync profile-status failed:", err);
    return internalError(err instanceof Error ? err.message : "Unknown error");
  }
}
