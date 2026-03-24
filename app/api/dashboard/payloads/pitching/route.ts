import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { octanePitchingPayloadQuerySchema } from "@/lib/validation/octane";
import { buildPitchingPayload } from "@/lib/octane/pitchingPayload";
import { requireRole } from "@/lib/auth/requireAuth";

/**
 * Dashboard-only: generate pitching payload for an athlete. No API key.
 */
export async function GET(request: NextRequest) {
  await requireRole("admin");
  try {
    const { searchParams } = new URL(request.url);
    const rawQuery = {
      athleteUuid: searchParams.get("athleteUuid") ?? undefined,
      latestOnly: searchParams.get("latestOnly") ?? undefined,
    };
    const queryValidation = octanePitchingPayloadQuerySchema.safeParse(rawQuery);
    if (!queryValidation.success) {
      return badRequest(
        queryValidation.error.issues.map((e) => e.message).join(", ")
      );
    }
    const payload = await buildPitchingPayload(queryValidation.data.athleteUuid);
    return success(payload);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Error in GET /api/dashboard/payloads/pitching:", error);
    return internalError("Failed to generate pitching payload");
  }
}
