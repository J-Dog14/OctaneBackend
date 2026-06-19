import { NextRequest } from "next/server";
import { badRequest, internalError, notFound, success } from "@/lib/responses";
import { requireAuth } from "@/lib/auth/requireAuth";
import { buildReadinessPayload } from "@/lib/dashboard/readinessPayload";

export async function GET(request: NextRequest) {
  await requireAuth();
  try {
    const athleteUuid = new URL(request.url).searchParams.get("athleteUuid");
    if (!athleteUuid) return badRequest("athleteUuid is required");

    const payload = await buildReadinessPayload(athleteUuid);
    return success(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) return notFound(msg);
    console.error("GET /api/dashboard/readiness-screen:", err);
    return internalError("Failed to load readiness data");
  }
}
