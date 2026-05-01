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

function calculateAgeGroup(dob: Date): string {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  if (age < 14) return "YOUTH";
  if (age <= 18) return "HIGH SCHOOL";
  if (age <= 22) return "COLLEGE";
  return "PRO";
}

/**
 * PATCH dashboard athlete: update email, date_of_birth, height, weight, or gender.
 * Supported body fields: { email?, date_of_birth?, height?, weight?, gender? }
 * When date_of_birth is provided, age_group is recalculated automatically.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  await requireAuth();
  try {
    const { uuid } = await params;
    if (!uuid) return notFound("Athlete not found");

    let body: { email?: string; date_of_birth?: string; height?: number; weight?: number; gender?: string };
    try {
      body = await request.json();
    } catch {
      return badRequest("JSON body required");
    }

    const athlete = await prisma.d_athletes.findUnique({
      where: { athlete_uuid: uuid },
      select: { athlete_uuid: true },
    });
    if (!athlete) return notFound("Athlete not found");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = { updated_at: new Date() };

    if (typeof body.email === "string") {
      const email = normalizeEmail(body.email) || null;
      data.email = email;
      if (email) {
        const resolved = await resolveAppUuidByEmail(email);
        if (resolved) {
          data.app_db_uuid = resolved;
          data.app_db_synced_at = new Date();
        }
      }
    }

    if (typeof body.date_of_birth === "string" && body.date_of_birth.trim()) {
      const dob = new Date(body.date_of_birth.trim());
      if (!isNaN(dob.getTime())) {
        data.date_of_birth = dob;
        data.age_group = calculateAgeGroup(dob);
      }
    }

    if (typeof body.height === "number" && body.height > 0) {
      data.height = body.height;
    }

    if (typeof body.weight === "number" && body.weight > 0) {
      data.weight = body.weight;
    }

    if (typeof body.gender === "string" && body.gender.trim()) {
      data.gender = body.gender.trim();
    }

    const updated = await prisma.d_athletes.update({
      where: { athlete_uuid: uuid },
      data,
      select: {
        athlete_uuid: true,
        name: true,
        email: true,
        date_of_birth: true,
        age_group: true,
        height: true,
        weight: true,
        gender: true,
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
