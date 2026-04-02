import { NextRequest } from "next/server";
import { requireApiKey } from "@/lib/auth/requireApiKey";
import { badRequest, internalError, success } from "@/lib/responses";
import { prismaDirect as prisma } from "@/lib/db/prisma-direct";
import { uaisAthletesQuerySchema } from "@/lib/validation/uais";

/**
 * GET /api/uais/athletes
 * Query:
 * - q: optional search string (matches name/normalized_name)
 * - limit: optional (default 50, max 200)
 * - cursor: optional athlete_uuid cursor for pagination
 */
export async function GET(request: NextRequest) {
  try {
    requireApiKey(request);

    const { searchParams } = new URL(request.url);
    const rawQuery = {
      q: searchParams.get("q") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      cursor: searchParams.get("cursor") ?? undefined,
    };

    const queryValidation = uaisAthletesQuerySchema.safeParse(rawQuery);
    if (!queryValidation.success) {
      return badRequest(
        queryValidation.error.issues.map((e) => e.message).join(", ")
      );
    }

    const { q, limit, cursor } = queryValidation.data;

    const where =
      q && q.trim().length > 0
        ? {
            OR: [
              { name: { contains: q.trim(), mode: "insensitive" as const } },
              {
                normalized_name: {
                  contains: q.trim().toLowerCase(),
                },
              },
            ],
          }
        : undefined;

    const items = await prisma.d_athletes.findMany({
      where,
      take: (limit ?? 50) + 1,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { athlete_uuid: cursor } : undefined,
      orderBy: { athlete_uuid: "asc" },
      select: {
        athlete_uuid: true,
        name: true,
        normalized_name: true,
        date_of_birth: true,
        gender: true,
        age_group: true,
        created_at: true,
        updated_at: true,
        has_pitching_data: true,
        has_hitting_data: true,
        has_athletic_screen_data: true,
        has_mobility_data: true,
        has_pro_sup_data: true,
        has_proteus_data: true,
        has_readiness_screen_data: true,
        has_arm_action_data: true,
        has_curveball_test_data: true,
        pitching_session_count: true,
        hitting_session_count: true,
        athletic_screen_session_count: true,
        mobility_session_count: true,
        pro_sup_session_count: true,
        proteus_session_count: true,
        readiness_screen_session_count: true,
        arm_action_session_count: true,
        curveball_test_session_count: true,
      },
    });

    const hasNext = items.length > (limit ?? 50);
    const results = hasNext ? items.slice(0, limit ?? 50) : items;
    const nextCursor =
      hasNext && results.length > 0 ? results[results.length - 1].athlete_uuid : null;

    return success({
      items: results,
      nextCursor,
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error("Error in GET /api/uais/athletes:", error);
    return internalError("Failed to fetch athletes");
  }
}

