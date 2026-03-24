import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { octaneSingleAthletePayloadQuerySchema } from "@/lib/validation/octane";
import { buildAthleticScreenPayload } from "@/lib/octane/athleticScreenPayload";
import { requireRole } from "@/lib/auth/requireAuth";

/**
 * Dashboard-only: generate athletic screen payload for an athlete. No API key.
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
    const payload = await buildAthleticScreenPayload(queryValidation.data.athleteUuid);
    return success(payload);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Error in GET /api/dashboard/payloads/athletic-screen:", error);
    return internalError("Failed to generate athletic screen payload");
  }
}
