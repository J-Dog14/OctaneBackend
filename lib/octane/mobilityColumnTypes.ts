/**
 * Shared column-type constants for the mobility screen.
 * No imports — safe to use in both server-side (mobilityPayload.ts) and client-side (domainHelpers.ts) code.
 */

/** Metrics graded on a 1/2/3 scale where 3 = optimal. Displayed as "X/3". */
export const SCALE_3_COLUMNS = new Set<string>([
  "back_to_wall_shoulder_flexion",
  "pelvic_tilt_against_wall",
  "radial_nerve_glide",
  "ulnar_nerve_glide",
  "backbend",
  "slump_test",
  "thomas_test_hip_flexor_r",
  "thomas_test_hip_flexor_l",
  "young_stretch_passive",
  "hip_pinch",
  "scap_winging",
]);

/** ROM metrics that lack an _rom suffix but are measured in degrees. */
const ROM_DEGREE_MANUAL = new Set<string>([
  "dominant_shoulder_ir",
  "dominant_shoulder_er",
  "non_dominant_shoulder_ir",
  "non_dominant_shoulder_er",
  "r_prone_hip_ir",
  "r_prone_hip_er",
  "l_prone_hip_ir",
  "l_prone_hip_er",
  "sittiing_t_spine_pvc_r",
  "sittiing_t_spine_pvc_l",
]);

/** Returns true if this column's value should be displayed with a "°" suffix. */
export function isRomDegreeColumn(key: string): boolean {
  return key.endsWith("_rom") || ROM_DEGREE_MANUAL.has(key);
}

/** Metrics shown in their group UI but excluded from the group score average. */
export const NON_SCORING_COLUMNS = new Set<string>([
  "isa_rom",
]);
