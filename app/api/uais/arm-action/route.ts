import { NextRequest } from "next/server";
import { requireApiKey } from "@/lib/auth/requireApiKey";
import { badRequest, internalError, notFound, success } from "@/lib/responses";
import { prismaDirect as prisma } from "@/lib/db/prisma-direct";
import { uaisArmActionQuerySchema } from "@/lib/validation/uais";

/**
 * GET /api/uais/arm-action?athleteUuid=<uuid>
 * 
 * Returns the arm action record with the highest score for the athlete.
 * If multiple records have the same highest score, returns the most recent one.
 * 
 * Returns these fields:
 * - arm_abduction_at_footplant
 * - max_abduction
 * - shoulder_angle_at_footplant
 * - max_er
 * - arm_velo
 * - max_torso_rot_velo
 * - torso_angle_at_footplant
 * - score
 */
export async function GET(request: NextRequest) {
  try {
    requireApiKey(request);

    const { searchParams } = new URL(request.url);
    const rawQuery = {
      athleteUuid: searchParams.get("athleteUuid") ?? undefined,
    };

    const queryValidation = uaisArmActionQuerySchema.safeParse(rawQuery);
    if (!queryValidation.success) {
      return badRequest(
        queryValidation.error.issues.map((e) => e.message).join(", ")
      );
    }

    const { athleteUuid } = queryValidation.data;

    // First, find the highest score for this athlete
    const maxScoreRecord = await prisma.f_arm_action.findFirst({
      where: {
        athlete_uuid: athleteUuid,
        score: { not: null },
      },
      orderBy: [
        { score: "desc" },
        { session_date: "desc" },
        { created_at: "desc" },
      ],
      select: {
        score: true,
      },
    });

    if (!maxScoreRecord || maxScoreRecord.score === null) {
      return notFound("No arm action data found for athlete");
    }

    // Now get the full record with the highest score (most recent if tied)
    const armAction = await prisma.f_arm_action.findFirst({
      where: {
        athlete_uuid: athleteUuid,
        score: maxScoreRecord.score,
      },
      orderBy: [
        { session_date: "desc" },
        { created_at: "desc" },
      ],
      select: {
        arm_abduction_at_footplant: true,
        max_abduction: true,
        shoulder_angle_at_footplant: true,
        max_er: true,
        arm_velo: true,
        max_torso_rot_velo: true,
        torso_angle_at_footplant: true,
        score: true,
        session_date: true,
        created_at: true,
      },
    });

    if (!armAction) {
      return notFound("Arm action record not found");
    }

    // Convert Decimal values to numbers
    const decimalToNumber = (value: unknown): number | null => {
      if (value === null || value === undefined) return null;
      if (typeof value === "number") return value;
      if (typeof value === "string") {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyVal = value as any;
      if (typeof anyVal.toNumber === "function") return anyVal.toNumber();
      if (typeof anyVal.toString === "function") {
        const num = Number(anyVal.toString());
        return Number.isFinite(num) ? num : null;
      }
      return null;
    };

    return success({
      athleteUuid,
      sessionDate: armAction.session_date.toISOString().split("T")[0],
      armAbductionAtFootplant: decimalToNumber(armAction.arm_abduction_at_footplant),
      maxAbduction: decimalToNumber(armAction.max_abduction),
      shoulderAngleAtFootplant: decimalToNumber(armAction.shoulder_angle_at_footplant),
      maxEr: decimalToNumber(armAction.max_er),
      armVelo: decimalToNumber(armAction.arm_velo),
      maxTorsoRotVelo: decimalToNumber(armAction.max_torso_rot_velo),
      torsoAngleAtFootplant: decimalToNumber(armAction.torso_angle_at_footplant),
      score: decimalToNumber(armAction.score),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error("Error in GET /api/uais/arm-action:", error);
    return internalError("Failed to fetch arm action data");
  }
}
