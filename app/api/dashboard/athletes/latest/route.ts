import { NextRequest } from "next/server";
import { internalError, success } from "@/lib/responses";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/requireAuth";

/**
 * GET /api/dashboard/athletes/latest?updated=1
 * Returns the single most recently updated (or created) athlete.
 * Used after "Run selected" (New Athlete) to target the email popup.
 */
export async function GET(request: NextRequest) {
  await requireAuth();
  try {
    const { searchParams } = new URL(request.url);
    const orderByUpdated = searchParams.get("updated") === "1";

    const athlete = await prisma.d_athletes.findFirst({
      orderBy: orderByUpdated ? { updated_at: "desc" } : { created_at: "desc" },
      select: {
        athlete_uuid: true,
        name: true,
        email: true,
        date_of_birth: true,
        height: true,
        weight: true,
        gender: true,
        app_db_uuid: true,
        app_db_synced_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!athlete) {
      return success(null);
    }
    return success(athlete);
  } catch (error) {
    console.error("Error in GET /api/dashboard/athletes/latest:", error);
    return internalError("Failed to fetch latest athlete");
  }
}
