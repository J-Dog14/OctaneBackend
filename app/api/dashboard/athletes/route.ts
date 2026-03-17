import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { getAthletesList } from "@/lib/dashboard/athletes";
import { uaisAthletesQuerySchema } from "@/lib/validation/uais";
import { requireAuth } from "@/lib/auth/requireAuth";

/**
 * Dashboard-only: list athletes (same shape as /api/uais/athletes).
 * Sorted alphabetically by name. No API key required.
 */
export async function GET(request: NextRequest) {
  await requireAuth();
  try {
    const { searchParams } = new URL(request.url);
    const rawQuery = {
      q: searchParams.get("q") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      cursor: searchParams.get("cursor") ?? undefined,
      filterNonApp: searchParams.get("filterNonApp") ?? searchParams.get("nonApp") ?? undefined,
    };

    const queryValidation = uaisAthletesQuerySchema.safeParse(rawQuery);
    if (!queryValidation.success) {
      return badRequest(
        queryValidation.error.issues.map((e) => e.message).join(", ")
      );
    }

    const { q, limit, cursor, filterNonApp } = queryValidation.data;
    const { items, nextCursor } = await getAthletesList({
      q,
      limit: limit ?? 50,
      cursor,
      filterNonApp: filterNonApp ?? false,
    });

    return success({
      items,
      nextCursor,
    });
  } catch (error) {
    console.error("Error in GET /api/dashboard/athletes:", error);
    return internalError("Failed to fetch athletes");
  }
}
