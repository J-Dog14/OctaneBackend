import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { octaneSingleAthletePayloadQuerySchema } from "@/lib/validation/octane";
import { buildArmActionPayload } from "@/lib/octane/armActionPayload";
import { requireRole } from "@/lib/auth/requireAuth";

/**
 * Dashboard-only: generate arm action payload for an athlete. No API key.
 */
export async function GET(request: NextRequest) {
  await requireRole("admin");
  try {
    const { searchParams } = new URL(request.url);
    const rawQuery = {
      athleteUuid: searchParams.get("athleteUuid") ?? undefined,
    };
    const queryValidation = octaneSingleAthletePayloadQuerySchema.safeParse(rawQuery);
    if (!queryValidation.success) {
      return badRequest(
        queryValidation.error.issues.map((e) => e.message).join(", ")
      );
    }
    const payload = await buildArmActionPayload(queryValidation.data.athleteUuid);
    return success(payload);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Error in GET /api/dashboard/payloads/arm-action:", error);
    return internalError("Failed to generate arm action payload");
  }
}
