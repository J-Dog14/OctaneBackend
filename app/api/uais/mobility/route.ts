import { NextRequest } from "next/server";
import { requireApiKey } from "@/lib/auth/requireApiKey";
import { badRequest, internalError, success } from "@/lib/responses";
import { prismaDirect as prisma } from "@/lib/db/prisma-direct";
import { Prisma } from "@prisma/client";
import { uaisMobilityQuerySchema } from "@/lib/validation/uais";

/**
 * GET /api/uais/mobility?athleteUuid=<uuid>
 *
 * Returns mobility data for the most recent session, organized by subcategories.
 * Uses raw SQL to reach dynamically-added columns not in the Prisma schema.
 *
 * Subcategories:
 * - Cervical
 * - Shoulder Mobility
 * - Shoulder Stability
 * - Elbow
 * - Spine / Core
 * - Hip Mobility
 * - Hip Stability
 * - Ankle
 * - Grip Strength
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

    const toNum = (v: unknown): number | null => {
      if (v == null) return null;
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : null; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = v as any;
      if (typeof a.toNumber === "function") return a.toNumber() as number;
      if (typeof a.toString === "function") { const n = Number(a.toString()); return Number.isFinite(n) ? n : null; }
      return null;
    };

    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
      Prisma.sql`
        SELECT *
        FROM public.f_mobility
        WHERE athlete_uuid = ${athleteUuid}
        ORDER BY session_date DESC, created_at DESC
        LIMIT 1
      `
    );

    if (!rows.length) {
      return success({ athleteUuid, sessionDate: null, subcategories: null });
    }

    const r = rows[0];
    const rawDate = r.session_date;
    const sessionDate =
      rawDate instanceof Date
        ? rawDate.toISOString().split("T")[0]
        : typeof rawDate === "string"
          ? rawDate.split("T")[0]
          : null;

    return success({
      athleteUuid,
      sessionDate,
      optimalRanges: r.optimal_ranges ?? null,
      subcategories: {
        "Cervical": {
          cervicalRotationR: toNum(r.cervical_rotation_r_rom),
          cervicalRotationL: toNum(r.cervical_rotation_l_rom),
          cervicalFlexion: toNum(r.cervical_flexion_rom),
          cervicalExtension: toNum(r.cervical_extension_rom),
          cervicalLateralFlexionR: toNum(r.cervical_lateral_flexion_r_rom),
          cervicalLateralFlexionL: toNum(r.cervical_lateral_flexion_l_rom),
        },
        "Shoulder Mobility": {
          horizontalAbduction: toNum(r.horizontal_abduction_rom),
          backToWallShoulderFlexion: toNum(r.back_to_wall_shoulder_flexion),
          dominantShoulderIr: toNum(r.dominant_shoulder_ir),
          dominantShoulderEr: toNum(r.dominant_shoulder_er),
          nonDominantShoulderIr: toNum(r.non_dominant_shoulder_ir),
          nonDominantShoulderEr: toNum(r.non_dominant_shoulder_er),
        },
        "Shoulder Stability": {
          hawkinsKennedy: toNum(r.hawkins_kennedy_test),
          stabilityFlexion: toNum(r.shoulder_stability_flexion_mmt),
          stabilityAbduction: toNum(r.shoulder_stability_abduction_mmt),
          stabilityEr: toNum(r.shoulder_stability_er_at_0_deg_horiz_abduction_mmt),
          stabilityIr: toNum(r.shoulder_stability_ir_at_0_deg_horiz_abduction_mmt),
          midTrap: toNum(r.mid_trap_mmt),
          lowTrap: toNum(r.low_trap_mmt),
          scapWinging: toNum(r.scap_winging),
        },
        "Elbow": {
          elbowExtension: toNum(r.elbow_extension_rom),
          elbowFlexion: toNum(r.elbow_flexion_rom),
          elbowPronation: toNum(r.elbow_pronation_rom),
          elbowSupination: toNum(r.elbow_supination_rom),
          radialNerveGlide: toNum(r.radial_nerve_glide),
          ulnarNerveGlide: toNum(r.ulnar_nerve_glide),
        },
        "Spine / Core": {
          pelvicTiltWall: toNum(r.pelvic_tilt_against_wall),
          backbend: toNum(r.backbend),
          tSpinePvcR: toNum(r.sittiing_t_spine_pvc_r),
          tSpinePvcL: toNum(r.sittiing_t_spine_pvc_l),
          slumpTest: toNum(r.slump_test),
          isa: toNum(r.isa_rom),
        },
        "Hip Mobility": {
          thomasTestR: toNum(r.thomas_test_hip_flexor_r),
          thomasTestL: toNum(r.thomas_test_hip_flexor_l),
          hamstringR: toNum(r.r_hamstring_stretch_rom),
          hamstringL: toNum(r.l_hamstring_stretch_rom),
          hipAbductionR: toNum(r.r_hip_abduction_rom),
          hipAbductionL: toNum(r.l_hip_abduction_rom),
          youngStretch: toNum(r.young_stretch_passive),
          hipPinch: toNum(r.hip_pinch),
          hipFlexionR: toNum(r.r_hip_flexion_rom),
          hipFlexionL: toNum(r.l_hip_flexion_rom),
          proneHipIrR: toNum(r.r_prone_hip_ir),
          proneHipErR: toNum(r.r_prone_hip_er),
          proneHipIrL: toNum(r.l_prone_hip_ir),
          proneHipErL: toNum(r.l_prone_hip_er),
        },
        "Hip Stability": {
          seatedHipIrR: toNum(r.seated_r_hip_ir_mmt),
          seatedHipIrL: toNum(r.seated_l_hip_ir_mmt),
          seatedHipErR: toNum(r.seated_r_hip_er_mmt),
          seatedHipErL: toNum(r.seated_l_hip_er_mmt),
          hamstringRaiseR: toNum(r.r_prone_hamstring_raise_mmt),
          hamstringRaiseL: toNum(r.l_prone_hamstring_raise_mmt),
          gluteRaiseR: toNum(r.r_prone_glute_raise_mmt),
          gluteRaiseL: toNum(r.l_prone_glute_raise_mmt),
          hipAbductionMmtR: toNum(r.r_hip_abduction_mmt),
          hipAdductionMmtL: toNum(r.l_hip_adduction_mmt),
          hipAdductionMmtR: toNum(r.r_hip_adduction_mmt),
          hipAbductionMmtL: toNum(r.l_hip_abduction_mmt),
        },
        "Ankle": {
          dorsiflexionR: toNum(r.r_ankle_dorsiflexion_to_wall_rom),
          dorsiflexionL: toNum(r.l_ankle_dorsiflexion_to_wall_rom),
          dorsiflexionMmtR: toNum(r.r_ankle_dorsiflexion_mmt),
          inversionR: toNum(r.r_ankle_inversion_mmt),
          eversionR: toNum(r.r_ankle_eversion_mmt),
          dorsiflexionMmtL: toNum(r.l_ankle_dorsiflexion_mmt),
          inversionL: toNum(r.l_ankle_inversion_mmt),
          eversionL: toNum(r.l_ankle_eversion_mmt),
        },
        "Grip Strength": {
          gripStrengthR: toNum(r.grip_strength_r),
          gripStrengthL: toNum(r.gs_l),
          gripStrengthRAt90: toNum(r.grip_strength_r_at_90),
          gripStrengthLAt90: toNum(r.gs_l_at_90),
        },
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Error in GET /api/uais/mobility:", error);
    return internalError("Failed to fetch mobility data");
  }
}
