import { NextRequest } from "next/server";
import { badRequest, internalError, notFound, success } from "@/lib/responses";
import { buildAthleteReportPayload } from "@/lib/octane/reportPayload";
import { prisma } from "@/lib/db/prisma";
import { resolveAppUuidByEmail } from "@/lib/dashboard/appDbResolver";
import { requireAuth } from "@/lib/auth/requireAuth";

/**
 * Dashboard-only: single athlete with full report payload (counts).
 * No API key required.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  await requireAuth();
  try {
    const { uuid } = await params;
    if (!uuid) {
      return notFound("Athlete not found");
    }
    const payload = await buildAthleteReportPayload(uuid);
    return success(payload);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Error in GET /api/dashboard/athletes/[uuid]:", error);
    return internalError("Failed to fetch athlete");
  }
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * PATCH dashboard athlete: update email (and optionally app_db_uuid / app_db_synced_at when resolved).
 * Body: { email: string }. Email is normalized (trim, lowercase).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  await requireAuth();
  try {
    const { uuid } = await params;
    if (!uuid) return notFound("Athlete not found");

    let body: { email?: string };
    try {
      body = await request.json();
    } catch {
      return badRequest("JSON body required");
    }
    const rawEmail = body.email;
    if (typeof rawEmail !== "string") {
      return badRequest("email is required");
    }
    const email = normalizeEmail(rawEmail) || null;

    const athlete = await prisma.d_athletes.findUnique({
      where: { athlete_uuid: uuid },
      select: { athlete_uuid: true },
    });
    if (!athlete) return notFound("Athlete not found");

    let app_db_uuid: string | null = null;
    let app_db_synced_at: Date | null = null;
    if (email) {
      const resolved = await resolveAppUuidByEmail(email);
      if (resolved) {
        app_db_uuid = resolved;
        app_db_synced_at = new Date();
      }
    }

    const updated = await prisma.d_athletes.update({
      where: { athlete_uuid: uuid },
      data: {
        email,
        updated_at: new Date(),
        ...(app_db_uuid != null && { app_db_uuid, app_db_synced_at }),
      },
      select: {
        athlete_uuid: true,
        name: true,
        email: true,
        app_db_uuid: true,
        app_db_synced_at: true,
        updated_at: true,
      },
    });
    return success(updated);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Error in PATCH /api/dashboard/athletes/[uuid]:", error);
    return internalError("Failed to update athlete");
  }
}
