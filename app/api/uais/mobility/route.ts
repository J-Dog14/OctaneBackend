import { NextRequest } from "next/server";
import { requireApiKey } from "@/lib/auth/requireApiKey";
import { badRequest, internalError, success } from "@/lib/responses";
import { prismaDirect as prisma } from "@/lib/db/prisma-direct";
import { uaisMobilityQuerySchema } from "@/lib/validation/uais";

/**
 * GET /api/uais/mobility?athleteUuid=<uuid>
 * 
 * Returns mobility data for the most recent session, organized by subcategories.
 * 
 * Subcategories:
 * - Shoulder/Arm Mobility (9 variables)
 * - Hip Mobility (9 variables)
 * - T-Spine (3 variables)
 * - Injury Prevention (13 variables)
 * - Neural Tension (3 variables)
 */
export async function GET(request: NextRequest) {
  try {
    requireApiKey(request);

    const { searchParams } = new URL(request.url);
    const rawQuery = {
      athleteUuid: searchParams.get("athleteUuid") ?? undefined,
    };

    const queryValidation = uaisMobilityQuerySchema.safeParse(rawQuery);
    if (!queryValidation.success) {
      return badRequest(
        queryValidation.error.issues.map((e) => e.message).join(", ")
      );
    }

    const { athleteUuid } = queryValidation.data;

    // Helper to convert Decimal to number
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

    // Find the most recent session for this athlete
    const mostRecentSession = await prisma.f_mobility.findFirst({
      where: { athlete_uuid: athleteUuid },
      orderBy: [{ session_date: "desc" }, { created_at: "desc" }],
      select: {
        session_date: true,
        // Shoulder/Arm Mobility
        back_to_wall_shoulder_flexion: true,
        horizontal_abduction: true,
        elbow_extension_rom: true,
        elbow_flexion_rom: true,
        elbow_supination_rom: true,
        elbow_pronation_rom: true,
        shoulder_ir: true,
        shoulder_er: true,
        young_stretch_passive: true,
        // Hip Mobility
        thomas_test_hip_flexor_r: true,
        thomas_test_hip_flexor_l: true,
        hamstring_stretch: true,
        hip_pinch: true,
        r_prone_hip_ir: true,
        l_prone_hip_ir: true,
        r_prone_hip_er: true,
        l_prone_hip_er: true,
        pelvic_tilt_against_wall: true,
        // T-Spine
        backbend: true,
        sittiing_t_spine_pvc_r: true,
        sittiing_t_spine_pvc_l: true,
        // Injury Prevention
        shoulder_stability_flexion: true,
        shoulder_stability_abduction: true,
        shoulder_stability_er_at_0_deg_horiz_abuduction: true,
        shoulder_stability_ir_at_0_deg_horiz_abduction: true,
        grip_strength_r: true,
        gs_l: true,
        grip_strength_r_at_90: true,
        gs_l_at_90: true,
        ankle_manual_test: true,
        prone_hamstring_raise: true,
        glute_strength_test_prone_hammy_push: true,
        mid_trap: true,
        low_trap: true,
        // Neural Tension
        radial_nerve_glide: true,
        ulnar_nerve_glide: true,
        slump_test: true,
      },
    });

    if (!mostRecentSession) {
      return success({
        athleteUuid,
        sessionDate: null,
        subcategories: null,
      });
    }

    return success({
      athleteUuid,
      sessionDate: mostRecentSession.session_date.toISOString().split("T")[0],
      subcategories: {
        "Shoulder/Arm Mobility": {
          backToWallShoulderFlexion: decimalToNumber(
            mostRecentSession.back_to_wall_shoulder_flexion
          ),
          horizontalAbduction: decimalToNumber(
            mostRecentSession.horizontal_abduction
          ),
          elbowExtensionRom: decimalToNumber(
            mostRecentSession.elbow_extension_rom
          ),
          elbowFlexionRom: decimalToNumber(
            mostRecentSession.elbow_flexion_rom
          ),
          forearmSupinationRom: decimalToNumber(
            mostRecentSession.elbow_supination_rom
          ),
          forearmPronationRom: decimalToNumber(
            mostRecentSession.elbow_pronation_rom
          ),
          shoulderIr: decimalToNumber(mostRecentSession.shoulder_ir),
          shoulderEr: decimalToNumber(mostRecentSession.shoulder_er),
          youngStretch: decimalToNumber(mostRecentSession.young_stretch_passive),
        },
        "Hip Mobility": {
          thomasTestHipFlexorR: decimalToNumber(
            mostRecentSession.thomas_test_hip_flexor_r
          ),
          thomasTestHipFlexorL: decimalToNumber(
            mostRecentSession.thomas_test_hip_flexor_l
          ),
          hamstringStretch: decimalToNumber(
            mostRecentSession.hamstring_stretch
          ),
          hipPinch: decimalToNumber(mostRecentSession.hip_pinch),
          rProneHipIr: decimalToNumber(mostRecentSession.r_prone_hip_ir),
          lProneHipIr: decimalToNumber(mostRecentSession.l_prone_hip_ir),
          rProneHipEr: decimalToNumber(mostRecentSession.r_prone_hip_er),
          lProneHipEr: decimalToNumber(mostRecentSession.l_prone_hip_er),
          pelvicTiltAgainstWall: decimalToNumber(
            mostRecentSession.pelvic_tilt_against_wall
          ),
        },
        "T-Spine": {
          backbend: decimalToNumber(mostRecentSession.backbend),
          sittingTSpinePvcR: decimalToNumber(
            mostRecentSession.sittiing_t_spine_pvc_r
          ),
          sittingTSpinePvcL: decimalToNumber(
            mostRecentSession.sittiing_t_spine_pvc_l
          ),
        },
        "Injury Prevention": {
          shoulderStabilityFlexion: decimalToNumber(
            mostRecentSession.shoulder_stability_flexion
          ),
          shoulderStabilityAbduction: decimalToNumber(
            mostRecentSession.shoulder_stability_abduction
          ),
          shoulderStabilityErAt0DegHorizAbduction: decimalToNumber(
            mostRecentSession.shoulder_stability_er_at_0_deg_horiz_abuduction
          ),
          shoulderStabilityIrAt0DegHorizAbduction: decimalToNumber(
            mostRecentSession.shoulder_stability_ir_at_0_deg_horiz_abduction
          ),
          gripStrengthR: decimalToNumber(mostRecentSession.grip_strength_r),
          gripStrengthL: decimalToNumber(mostRecentSession.gs_l),
          gripStrengthRAt90: decimalToNumber(
            mostRecentSession.grip_strength_r_at_90
          ),
          gripStrengthLAt90: decimalToNumber(mostRecentSession.gs_l_at_90),
          ankleManualTest: decimalToNumber(
            mostRecentSession.ankle_manual_test
          ),
          proneHamstringRaise: decimalToNumber(
            mostRecentSession.prone_hamstring_raise
          ),
          gluteStrengthTestProneHammyPush: decimalToNumber(
            mostRecentSession.glute_strength_test_prone_hammy_push
          ),
          midTrap: decimalToNumber(mostRecentSession.mid_trap),
          lowTrap: decimalToNumber(mostRecentSession.low_trap),
        },
        "Neural Tension": {
          radialNerveGlide: decimalToNumber(
            mostRecentSession.radial_nerve_glide
          ),
          ulnarNerveGlide: decimalToNumber(
            mostRecentSession.ulnar_nerve_glide
          ),
          slumpTest: decimalToNumber(mostRecentSession.slump_test),
        },
      },
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error("Error in GET /api/uais/mobility:", error);
    return internalError("Failed to fetch mobility data");
  }
}
