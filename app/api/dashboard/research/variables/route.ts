import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/requireAuth";
import { success, badRequest, internalError } from "@/lib/responses";
import { prisma } from "@/lib/db/prisma";

export type VariableInfo = {
  key: string;
  label: string;
  isJsonb: boolean;
  group: string; // "Direct" | "Kinematics (JSON)"
};

// ─── Column definitions per table ────────────────────────────────────────────

const DIRECT_COLUMNS: Record<string, VariableInfo[]> = {
  pitching: [
    { key: "velocity_mph",      label: "Velocity (mph)",          isJsonb: false, group: "Direct" },
    { key: "score",             label: "Score",                   isJsonb: false, group: "Direct" },
    { key: "age_at_collection", label: "Age at Collection",       isJsonb: false, group: "Direct" },
    { key: "height",            label: "Height (in)",             isJsonb: false, group: "Direct" },
    { key: "weight",            label: "Weight (lbs)",            isJsonb: false, group: "Direct" },
  ],
  hitting: [
    { key: "age_at_collection", label: "Age at Collection",       isJsonb: false, group: "Direct" },
    { key: "height",            label: "Height (in)",             isJsonb: false, group: "Direct" },
    { key: "weight",            label: "Weight (lbs)",            isJsonb: false, group: "Direct" },
  ],
  athletic_screen_cmj: [
    { key: "jh_in",                label: "Jump Height (in)",               isJsonb: false, group: "Direct" },
    { key: "peak_power",           label: "Peak Power (normalized)",         isJsonb: false, group: "Direct" },
    { key: "pp_forceplate",        label: "Peak Power — Force Plate",       isJsonb: false, group: "Direct" },
    { key: "force_at_pp",          label: "Force at Peak Power",            isJsonb: false, group: "Direct" },
    { key: "vel_at_pp",            label: "Velocity at Peak Power",         isJsonb: false, group: "Direct" },
    { key: "pp_w_per_kg",          label: "Peak Power (W/kg)",              isJsonb: false, group: "Direct" },
    { key: "peak_power_w",         label: "Peak Power (W)",                 isJsonb: false, group: "Direct" },
    { key: "time_to_peak_s",       label: "Time to Peak (s)",               isJsonb: false, group: "Direct" },
    { key: "rpd_max_w_per_s",      label: "Max Rate of Power Dev (W/s)",    isJsonb: false, group: "Direct" },
    { key: "time_to_rpd_max_s",    label: "Time to Max RPD (s)",            isJsonb: false, group: "Direct" },
    { key: "rise_time_10_90_s",    label: "Rise Time 10–90% (s)",           isJsonb: false, group: "Direct" },
    { key: "fwhm_s",               label: "FWHM (s)",                       isJsonb: false, group: "Direct" },
    { key: "auc_j",                label: "Area Under Curve (J)",           isJsonb: false, group: "Direct" },
    { key: "work_early_pct",       label: "Work Early %",                   isJsonb: false, group: "Direct" },
    { key: "decay_90_10_s",        label: "Decay 90–10% (s)",               isJsonb: false, group: "Direct" },
    { key: "t_com_norm_0to1",      label: "COM Timing (0–1 normalized)",    isJsonb: false, group: "Direct" },
    { key: "skewness",             label: "Skewness",                       isJsonb: false, group: "Direct" },
    { key: "kurtosis",             label: "Kurtosis",                       isJsonb: false, group: "Direct" },
    { key: "spectral_centroid_hz", label: "Spectral Centroid (Hz)",         isJsonb: false, group: "Direct" },
  ],
  athletic_screen_dj: [
    { key: "jh_in",             label: "Jump Height (in)",            isJsonb: false, group: "Direct" },
    { key: "ct",                label: "Contact Time (s)",            isJsonb: false, group: "Direct" },
    { key: "rsi",               label: "Reactive Strength Index",     isJsonb: false, group: "Direct" },
    { key: "pp_w_per_kg",       label: "Peak Power (W/kg)",           isJsonb: false, group: "Direct" },
    { key: "peak_power_w",      label: "Peak Power (W)",              isJsonb: false, group: "Direct" },
    { key: "time_to_peak_s",    label: "Time to Peak (s)",            isJsonb: false, group: "Direct" },
    { key: "rpd_max_w_per_s",   label: "Max Rate of Power Dev (W/s)", isJsonb: false, group: "Direct" },
    { key: "rise_time_10_90_s", label: "Rise Time 10–90% (s)",        isJsonb: false, group: "Direct" },
    { key: "fwhm_s",            label: "FWHM (s)",                    isJsonb: false, group: "Direct" },
    { key: "auc_j",             label: "AUC (J)",                     isJsonb: false, group: "Direct" },
  ],
  athletic_screen_slv: [
    { key: "jh_in",           label: "Jump Height (in)",            isJsonb: false, group: "Direct" },
    { key: "pp_w_per_kg",     label: "Peak Power (W/kg)",           isJsonb: false, group: "Direct" },
    { key: "peak_power_w",    label: "Peak Power (W)",              isJsonb: false, group: "Direct" },
    { key: "time_to_peak_s",  label: "Time to Peak (s)",            isJsonb: false, group: "Direct" },
    { key: "rpd_max_w_per_s", label: "Max Rate of Power Dev (W/s)", isJsonb: false, group: "Direct" },
    { key: "fwhm_s",          label: "FWHM (s)",                    isJsonb: false, group: "Direct" },
    { key: "auc_j",           label: "AUC (J)",                     isJsonb: false, group: "Direct" },
  ],
  athletic_screen_nmt: [
    { key: "num_taps_10s", label: "Taps in First 10s",  isJsonb: false, group: "Direct" },
    { key: "num_taps_20s", label: "Taps in First 20s",  isJsonb: false, group: "Direct" },
    { key: "num_taps_30s", label: "Taps in First 30s",  isJsonb: false, group: "Direct" },
    { key: "num_taps",     label: "Total Taps",          isJsonb: false, group: "Direct" },
  ],
  athletic_screen_ppu: [
    { key: "jh_in",           label: "Jump Height (in)",            isJsonb: false, group: "Direct" },
    { key: "peak_power",      label: "Peak Power (normalized)",      isJsonb: false, group: "Direct" },
    { key: "pp_w_per_kg",     label: "Peak Power (W/kg)",           isJsonb: false, group: "Direct" },
    { key: "peak_power_w",    label: "Peak Power (W)",              isJsonb: false, group: "Direct" },
    { key: "time_to_peak_s",  label: "Time to Peak (s)",            isJsonb: false, group: "Direct" },
    { key: "rpd_max_w_per_s", label: "Max Rate of Power Dev (W/s)", isJsonb: false, group: "Direct" },
    { key: "fwhm_s",          label: "FWHM (s)",                    isJsonb: false, group: "Direct" },
    { key: "auc_j",           label: "AUC (J)",                     isJsonb: false, group: "Direct" },
  ],
  mobility: [
    { key: "cervical_rotation",             label: "Cervical Rotation",                isJsonb: false, group: "Direct" },
    { key: "cervical_flexion",              label: "Cervical Flexion",                 isJsonb: false, group: "Direct" },
    { key: "cervical_extension",            label: "Cervical Extension",               isJsonb: false, group: "Direct" },
    { key: "cervical_lateral_flexion",      label: "Cervical Lateral Flexion",         isJsonb: false, group: "Direct" },
    { key: "shoulder_total_arc",            label: "Shoulder Total Arc",               isJsonb: false, group: "Direct" },
    { key: "horizontal_abduction",          label: "Horizontal Abduction",             isJsonb: false, group: "Direct" },
    { key: "back_to_wall_shoulder_flexion", label: "Back to Wall Shoulder Flexion",    isJsonb: false, group: "Direct" },
    { key: "pelvic_tilt_against_wall",      label: "Pelvic Tilt Against Wall",         isJsonb: false, group: "Direct" },
    { key: "shoulder_ir",                   label: "Shoulder IR",                      isJsonb: false, group: "Direct" },
    { key: "shoulder_er",                   label: "Shoulder ER",                      isJsonb: false, group: "Direct" },
    { key: "supine_shoulder_flexion",       label: "Supine Shoulder Flexion",          isJsonb: false, group: "Direct" },
    { key: "elbow_extension_rom",           label: "Elbow Extension ROM",              isJsonb: false, group: "Direct" },
    { key: "elbow_flexion_rom",             label: "Elbow Flexion ROM",                isJsonb: false, group: "Direct" },
    { key: "elbow_pronation_rom",           label: "Elbow Pronation ROM",              isJsonb: false, group: "Direct" },
    { key: "elbow_supination_rom",          label: "Elbow Supination ROM",             isJsonb: false, group: "Direct" },
    { key: "radial_nerve_glide",            label: "Radial Nerve Glide",               isJsonb: false, group: "Direct" },
    { key: "ulnar_nerve_glide",             label: "Ulnar Nerve Glide",                isJsonb: false, group: "Direct" },
    { key: "grip_strength",                 label: "Grip Strength",                    isJsonb: false, group: "Direct" },
    { key: "grip_strength_r",               label: "Grip Strength (R)",                isJsonb: false, group: "Direct" },
    { key: "grip_strength_r_at_90",         label: "Grip Strength R at 90°",           isJsonb: false, group: "Direct" },
    { key: "hamstring_stretch",             label: "Hamstring Stretch",                isJsonb: false, group: "Direct" },
    { key: "r_hip_ir",                      label: "Hip IR (R)",                       isJsonb: false, group: "Direct" },
    { key: "r_hip_er",                      label: "Hip ER (R)",                       isJsonb: false, group: "Direct" },
    { key: "l_hip_ir",                      label: "Hip IR (L)",                       isJsonb: false, group: "Direct" },
    { key: "l_hip_er",                      label: "Hip ER (L)",                       isJsonb: false, group: "Direct" },
    { key: "r_prone_hip_ir",                label: "Prone Hip IR (R)",                 isJsonb: false, group: "Direct" },
    { key: "r_prone_hip_er",                label: "Prone Hip ER (R)",                 isJsonb: false, group: "Direct" },
    { key: "l_prone_hip_ir",                label: "Prone Hip IR (L)",                 isJsonb: false, group: "Direct" },
    { key: "l_prone_hip_er",                label: "Prone Hip ER (L)",                 isJsonb: false, group: "Direct" },
    { key: "thomas_test_hip_flexor_r",      label: "Thomas Test Hip Flexor (R)",       isJsonb: false, group: "Direct" },
    { key: "thomas_test_hip_flexor_l",      label: "Thomas Test Hip Flexor (L)",       isJsonb: false, group: "Direct" },
    { key: "ankle_dorsiflextion_to_wall",   label: "Ankle Dorsiflexion to Wall",       isJsonb: false, group: "Direct" },
    { key: "backbend",                      label: "Backbend",                         isJsonb: false, group: "Direct" },
    { key: "isa",                           label: "ISA",                              isJsonb: false, group: "Direct" },
    { key: "age_at_collection",             label: "Age at Collection",                isJsonb: false, group: "Direct" },
  ],
  pro_sup: [
    { key: "forearm_rom",          label: "Forearm ROM",             isJsonb: false, group: "Direct" },
    { key: "tot_rom",              label: "Total ROM",               isJsonb: false, group: "Direct" },
    { key: "avg_velo",             label: "Avg Velocity",            isJsonb: false, group: "Direct" },
    { key: "total_score",          label: "Total Score",             isJsonb: false, group: "Direct" },
    { key: "total_fatigue_score",  label: "Total Fatigue Score",     isJsonb: false, group: "Direct" },
    { key: "cumulative_rom",       label: "Cumulative ROM",          isJsonb: false, group: "Direct" },
    { key: "raw_total_score",      label: "Raw Total Score",         isJsonb: false, group: "Direct" },
    { key: "num_of_flips",         label: "Num of Flips",            isJsonb: false, group: "Direct" },
    { key: "forearm_rom_0to10",    label: "Forearm ROM 0–10s",       isJsonb: false, group: "Direct" },
    { key: "forearm_rom_10to20",   label: "Forearm ROM 10–20s",      isJsonb: false, group: "Direct" },
    { key: "forearm_rom_20to30",   label: "Forearm ROM 20–30s",      isJsonb: false, group: "Direct" },
    { key: "tot_rom_0to10",        label: "Total ROM 0–10s",         isJsonb: false, group: "Direct" },
    { key: "tot_rom_10to20",       label: "Total ROM 10–20s",        isJsonb: false, group: "Direct" },
    { key: "tot_rom_20to30",       label: "Total ROM 20–30s",        isJsonb: false, group: "Direct" },
    { key: "avg_velo_0_10",        label: "Avg Velocity 0–10s",      isJsonb: false, group: "Direct" },
    { key: "avg_velo_10_20",       label: "Avg Velocity 10–20s",     isJsonb: false, group: "Direct" },
    { key: "avg_velo_20_30",       label: "Avg Velocity 20–30s",     isJsonb: false, group: "Direct" },
    { key: "num_of_flips_0_10",    label: "Flips 0–10s",             isJsonb: false, group: "Direct" },
    { key: "num_of_flips_10_20",   label: "Flips 10–20s",            isJsonb: false, group: "Direct" },
    { key: "num_of_flips_20_30",   label: "Flips 20–30s",            isJsonb: false, group: "Direct" },
    { key: "fatigue_index_10",     label: "Fatigue Index 10s",        isJsonb: false, group: "Direct" },
    { key: "fatigue_index_20",     label: "Fatigue Index 20s",        isJsonb: false, group: "Direct" },
    { key: "fatigue_index_30",     label: "Fatigue Index 30s",        isJsonb: false, group: "Direct" },
    { key: "consistency_penalty",  label: "Consistency Penalty",      isJsonb: false, group: "Direct" },
    { key: "age_at_collection",    label: "Age at Collection",        isJsonb: false, group: "Direct" },
    { key: "height",               label: "Height (in)",              isJsonb: false, group: "Direct" },
    { key: "weight",               label: "Weight (lbs)",             isJsonb: false, group: "Direct" },
  ],
  proteus: [
    { key: "power_mean",              label: "Power Mean",              isJsonb: false, group: "Direct" },
    { key: "power_high",              label: "Power High",              isJsonb: false, group: "Direct" },
    { key: "power_low",               label: "Power Low",               isJsonb: false, group: "Direct" },
    { key: "velocity_mean",           label: "Velocity Mean",           isJsonb: false, group: "Direct" },
    { key: "velocity_high",           label: "Velocity High",           isJsonb: false, group: "Direct" },
    { key: "velocity_low",            label: "Velocity Low",            isJsonb: false, group: "Direct" },
    { key: "acceleration_mean",       label: "Acceleration Mean",       isJsonb: false, group: "Direct" },
    { key: "acceleration_high",       label: "Acceleration High",       isJsonb: false, group: "Direct" },
    { key: "acceleration_low",        label: "Acceleration Low",        isJsonb: false, group: "Direct" },
    { key: "braking_mean",            label: "Braking Mean",            isJsonb: false, group: "Direct" },
    { key: "braking_high",            label: "Braking High",            isJsonb: false, group: "Direct" },
    { key: "braking_low",             label: "Braking Low",             isJsonb: false, group: "Direct" },
    { key: "deceleration_mean",       label: "Deceleration Mean",       isJsonb: false, group: "Direct" },
    { key: "deceleration_high",       label: "Deceleration High",       isJsonb: false, group: "Direct" },
    { key: "deceleration_low",        label: "Deceleration Low",        isJsonb: false, group: "Direct" },
    { key: "explosiveness_mean",      label: "Explosiveness Mean",      isJsonb: false, group: "Direct" },
    { key: "explosiveness_high",      label: "Explosiveness High",      isJsonb: false, group: "Direct" },
    { key: "explosiveness_low",       label: "Explosiveness Low",       isJsonb: false, group: "Direct" },
    { key: "range_of_motion_mean",    label: "Range of Motion Mean",    isJsonb: false, group: "Direct" },
    { key: "range_of_motion_high",    label: "Range of Motion High",    isJsonb: false, group: "Direct" },
    { key: "range_of_motion_low",     label: "Range of Motion Low",     isJsonb: false, group: "Direct" },
    { key: "consistency_mean",        label: "Consistency Mean",        isJsonb: false, group: "Direct" },
    { key: "consistency_high",        label: "Consistency High",        isJsonb: false, group: "Direct" },
    { key: "consistency_low",         label: "Consistency Low",         isJsonb: false, group: "Direct" },
    { key: "age_at_collection",       label: "Age at Collection",       isJsonb: false, group: "Direct" },
  ],
  readiness_screen_cmj: [
    { key: "jump_height",  label: "Jump Height",         isJsonb: false, group: "Direct" },
    { key: "peak_power",   label: "Peak Power",          isJsonb: false, group: "Direct" },
    { key: "peak_force",   label: "Peak Force",          isJsonb: false, group: "Direct" },
    { key: "pp_w_per_kg",  label: "Peak Power (W/kg)",   isJsonb: false, group: "Direct" },
    { key: "pp_forceplate",label: "Peak Power — Force Plate", isJsonb: false, group: "Direct" },
    { key: "force_at_pp",  label: "Force at Peak Power", isJsonb: false, group: "Direct" },
    { key: "vel_at_pp",    label: "Velocity at Peak Power", isJsonb: false, group: "Direct" },
  ],
  readiness_screen_i: [
    { key: "avg_force",      label: "Avg Force",           isJsonb: false, group: "Direct" },
    { key: "avg_force_norm", label: "Avg Force (norm)",    isJsonb: false, group: "Direct" },
    { key: "max_force",      label: "Max Force",           isJsonb: false, group: "Direct" },
    { key: "max_force_norm", label: "Max Force (norm)",    isJsonb: false, group: "Direct" },
    { key: "time_to_max",    label: "Time to Max",         isJsonb: false, group: "Direct" },
  ],
  readiness_screen_ir90: [
    { key: "avg_force",      label: "Avg Force",           isJsonb: false, group: "Direct" },
    { key: "avg_force_norm", label: "Avg Force (norm)",    isJsonb: false, group: "Direct" },
    { key: "max_force",      label: "Max Force",           isJsonb: false, group: "Direct" },
    { key: "max_force_norm", label: "Max Force (norm)",    isJsonb: false, group: "Direct" },
    { key: "time_to_max",    label: "Time to Max",         isJsonb: false, group: "Direct" },
  ],
  readiness_screen_ppu: [
    { key: "jump_height",  label: "Jump Height",               isJsonb: false, group: "Direct" },
    { key: "peak_power",   label: "Peak Power",                isJsonb: false, group: "Direct" },
    { key: "peak_force",   label: "Peak Force",                isJsonb: false, group: "Direct" },
    { key: "pp_w_per_kg",  label: "Peak Power (W/kg)",         isJsonb: false, group: "Direct" },
    { key: "pp_forceplate",label: "Peak Power — Force Plate",  isJsonb: false, group: "Direct" },
    { key: "force_at_pp",  label: "Force at Peak Power",       isJsonb: false, group: "Direct" },
    { key: "vel_at_pp",    label: "Velocity at Peak Power",    isJsonb: false, group: "Direct" },
  ],
  readiness_screen_t: [
    { key: "avg_force",      label: "Avg Force",           isJsonb: false, group: "Direct" },
    { key: "avg_force_norm", label: "Avg Force (norm)",    isJsonb: false, group: "Direct" },
    { key: "max_force",      label: "Max Force",           isJsonb: false, group: "Direct" },
    { key: "max_force_norm", label: "Max Force (norm)",    isJsonb: false, group: "Direct" },
    { key: "time_to_max",    label: "Time to Max",         isJsonb: false, group: "Direct" },
  ],
  readiness_screen_y: [
    { key: "avg_force",      label: "Avg Force",           isJsonb: false, group: "Direct" },
    { key: "avg_force_norm", label: "Avg Force (norm)",    isJsonb: false, group: "Direct" },
    { key: "max_force",      label: "Max Force",           isJsonb: false, group: "Direct" },
    { key: "max_force_norm", label: "Max Force (norm)",    isJsonb: false, group: "Direct" },
    { key: "time_to_max",    label: "Time to Max",         isJsonb: false, group: "Direct" },
  ],
};

/** Tables whose metrics column is JSONB and the actual SQL table name */
const JSONB_SQL_TABLES: Record<string, string> = {
  pitching: "f_pitching_trials",
  hitting:  "f_hitting_trials",
};

/** Valid table keys (whitelist to prevent injection via table param) */
export const VALID_TABLES = new Set(Object.keys(DIRECT_COLUMNS));

export const TABLE_LABELS: Record<string, string> = {
  pitching:              "Pitching (Trials)",
  hitting:               "Hitting (Trials)",
  athletic_screen_cmj:   "Athletic Screen — CMJ",
  athletic_screen_dj:    "Athletic Screen — Drop Jump",
  athletic_screen_slv:   "Athletic Screen — Single Leg Vertical",
  athletic_screen_nmt:   "Athletic Screen — Neuromuscular Tapping",
  athletic_screen_ppu:   "Athletic Screen — Push-up Power",
  mobility:              "Mobility",
  pro_sup:               "Pro-Sup",
  proteus:               "Proteus",
  readiness_screen_cmj:  "Readiness Screen — CMJ",
  readiness_screen_i:    "Readiness Screen — I",
  readiness_screen_ir90: "Readiness Screen — IR90",
  readiness_screen_ppu:  "Readiness Screen — PPU",
  readiness_screen_t:    "Readiness Screen — T",
  readiness_screen_y:    "Readiness Screen — Y",
};

/**
 * GET /api/dashboard/research/variables?table=pitching
 * Returns all selectable variables for the given table.
 */
export async function GET(request: NextRequest) {
  await requireAuth();
  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table") ?? "";

  if (!VALID_TABLES.has(table)) {
    return badRequest(`Unknown table "${table}". Valid: ${[...VALID_TABLES].join(", ")}`);
  }

  try {
    const direct = DIRECT_COLUMNS[table] ?? [];
    let jsonbVars: VariableInfo[] = [];

    const sqlTable = JSONB_SQL_TABLES[table];
    if (sqlTable) {
      const rows = await prisma.$queryRawUnsafe<Array<{ key: string }>>(
        `SELECT DISTINCT j.key
         FROM (
           SELECT metrics
           FROM "${sqlTable}"
           WHERE metrics IS NOT NULL
           ORDER BY id DESC
           LIMIT 200
         ) samples
         CROSS JOIN LATERAL jsonb_each(samples.metrics::jsonb) AS j(key, value)
         ORDER BY j.key
         LIMIT 3000`
      );
      jsonbVars = rows.map((r) => ({
        key:     `jsonb:${r.key}`,
        label:   r.key.replace(/_/g, " "),
        isJsonb: true,
        group:   "Kinematics (JSON)",
      }));
    }

    return success({ variables: [...direct, ...jsonbVars] });
  } catch (err) {
    console.error("[research/variables] error:", err);
    return internalError("Failed to fetch variables");
  }
}
