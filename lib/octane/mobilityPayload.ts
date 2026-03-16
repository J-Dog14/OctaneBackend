import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/responses";
import { decimalToNumber, deriveLevelFromAthlete } from "@/lib/octane/utils";

type Orientation = "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";
type ValueUnit = "NUMBER" | "DEGREES";

export type MobilityPayloadMetric = {
  category: string;
  name: string;
  value: number | null;
  valueUnit: ValueUnit | string;
  orientation: Orientation | string | null;
  mobilityMetricKind?: "GROUP" | "COMPONENT";
  mobilityGroup?: string;
  mobilityDisplayLabel?: string;
  mobilityOutOf?: number | null;
};

export type MobilityPayload = {
  athleteUuid: string;
  level: string;
  score: number | null;
  metrics: MobilityPayloadMetric[];
  sessionDate?: string | null;
};

/** Max possible score per category (Grip Strength has no max - raw sum). */
export const MOBILITY_CATEGORY_MAX: Record<string, number> = {
  "Hip Mobility": 21,
  "Hip Stability": 12,
  "Shoulder Mobility": 18,
  "Shoulder Stability": 12,
  "Trunk": 18,
  "Elbow": 18,
  "Grip Strength": Number.POSITIVE_INFINITY,
};

/** Group name -> list of f_mobility column names (snake_case) for group score sum */
const MOBILITY_GROUPS: Array<{
  groupName: string;
  columns: Array<{ key: keyof MobilityRow; label: string }>;
}> = [
  {
    groupName: "Hip Mobility",
    columns: [
      { key: "l_prone_hip_ir", label: "L IR" },
      { key: "l_prone_hip_er", label: "L ER" },
      { key: "r_prone_hip_ir", label: "R IR" },
      { key: "r_prone_hip_er", label: "R ER" },
      { key: "thomas_test_hip_flexor_l", label: "Thomas Test L" },
      { key: "thomas_test_hip_flexor_r", label: "Thomas Test R" },
      { key: "hamstring_stretch", label: "Hamstring" },
    ],
  },
  {
    groupName: "Hip Stability",
    columns: [
      { key: "hip_pinch", label: "Hip Pinch" },
      { key: "pelvic_tilt_against_wall", label: "Pelvic Tilt Wall" },
      { key: "glute_strength_test_prone_hammy_push", label: "Glute Strength" },
      { key: "prone_hamstring_raise", label: "Prone Ham Raise" },
    ],
  },
  {
    groupName: "Shoulder Mobility",
    columns: [
      { key: "shoulder_ir", label: "Shoulder IR" },
      { key: "shoulder_er", label: "Shoulder ER" },
      { key: "young_stretch_passive", label: "Young Stretch + Passive" },
      { key: "shoulder_total_arc", label: "Shoulder Total Arc" },
      { key: "horizontal_abduction", label: "Horizontal Abduction" },
      { key: "back_to_wall_shoulder_flexion", label: "Back to Wall Shoulder Flexion" },
    ],
  },
  {
    groupName: "Shoulder Stability",
    columns: [
      { key: "shoulder_stability_flexion", label: "Shoulder stability-flexion" },
      { key: "shoulder_stability_abduction", label: "Shoulder stability-abduction" },
      { key: "shoulder_stability_er_at_0_deg_horiz_abuduction", label: "Shoulder stability-ER at 0 deg. Horiz. Abduction" },
      { key: "shoulder_stability_ir_at_0_deg_horiz_abduction", label: "Shoulder stability-IR at 0 deg. Horiz. abduction" },
    ],
  },
  {
    groupName: "Trunk",
    columns: [
      { key: "backbend", label: "Backbend" },
      { key: "sittiing_t_spine_pvc_r", label: "Sitting T-spine PVC (R)" },
      { key: "sittiing_t_spine_pvc_l", label: "Sitting T-spine PVC (L)" },
      { key: "slump_test", label: "Slump Test" },
      { key: "mid_trap", label: "Mid Trap" },
      { key: "low_trap", label: "Low Trap" },
    ],
  },
  {
    groupName: "Elbow",
    columns: [
      { key: "elbow_extension_rom", label: "Elbow-extension (ROM)" },
      { key: "elbow_flexion_rom", label: "Elbow-flexion (ROM)" },
      { key: "elbow_pronation_rom", label: "Elbow-pronation (ROM)" },
      { key: "elbow_supination_rom", label: "Elbow-supination (ROM)" },
      { key: "radial_nerve_glide", label: "Radial Nerve glide" },
      { key: "ulnar_nerve_glide", label: "Ulnar Nerve Glide" },
    ],
  },
  {
    groupName: "Grip Strength",
    columns: [
      { key: "grip_strength_r", label: "Grip Strength (R)" },
      { key: "gs_l", label: "GS (L)" },
      { key: "grip_strength_r_at_90", label: "Grip Strength (R) at 90" },
      { key: "gs_l_at_90", label: "GS (L) at 90" },
    ],
  },
];

type MobilityRow = {
  r_prone_hip_ir: unknown;
  l_prone_hip_ir: unknown;
  r_prone_hip_er: unknown;
  l_prone_hip_er: unknown;
  thomas_test_hip_flexor_r: unknown;
  thomas_test_hip_flexor_l: unknown;
  hamstring_stretch: unknown;
  hip_pinch: unknown;
  pelvic_tilt_against_wall: unknown;
  glute_strength_test_prone_hammy_push: unknown;
  prone_hamstring_raise: unknown;
  shoulder_ir: unknown;
  shoulder_er: unknown;
  young_stretch_passive: unknown;
  shoulder_total_arc: unknown;
  horizontal_abduction: unknown;
  back_to_wall_shoulder_flexion: unknown;
  shoulder_stability_flexion: unknown;
  shoulder_stability_abduction: unknown;
  shoulder_stability_er_at_0_deg_horiz_abuduction: unknown;
  shoulder_stability_ir_at_0_deg_horiz_abduction: unknown;
  backbend: unknown;
  sittiing_t_spine_pvc_r: unknown;
  sittiing_t_spine_pvc_l: unknown;
  slump_test: unknown;
  mid_trap: unknown;
  low_trap: unknown;
  elbow_extension_rom: unknown;
  elbow_flexion_rom: unknown;
  elbow_pronation_rom: unknown;
  elbow_supination_rom: unknown;
  radial_nerve_glide: unknown;
  ulnar_nerve_glide: unknown;
  grip_strength_r: unknown;
  gs_l: unknown;
  grip_strength_r_at_90: unknown;
  gs_l_at_90: unknown;
};

const MOBILITY_SELECT = {
  r_prone_hip_ir: true,
  l_prone_hip_ir: true,
  r_prone_hip_er: true,
  l_prone_hip_er: true,
  thomas_test_hip_flexor_r: true,
  thomas_test_hip_flexor_l: true,
  hamstring_stretch: true,
  hip_pinch: true,
  pelvic_tilt_against_wall: true,
  glute_strength_test_prone_hammy_push: true,
  prone_hamstring_raise: true,
  shoulder_ir: true,
  shoulder_er: true,
  young_stretch_passive: true,
  shoulder_total_arc: true,
  horizontal_abduction: true,
  back_to_wall_shoulder_flexion: true,
  shoulder_stability_flexion: true,
  shoulder_stability_abduction: true,
  shoulder_stability_er_at_0_deg_horiz_abuduction: true,
  shoulder_stability_ir_at_0_deg_horiz_abduction: true,
  backbend: true,
  sittiing_t_spine_pvc_r: true,
  sittiing_t_spine_pvc_l: true,
  slump_test: true,
  mid_trap: true,
  low_trap: true,
  elbow_extension_rom: true,
  elbow_flexion_rom: true,
  elbow_pronation_rom: true,
  elbow_supination_rom: true,
  radial_nerve_glide: true,
  ulnar_nerve_glide: true,
  grip_strength_r: true,
  gs_l: true,
  grip_strength_r_at_90: true,
  gs_l_at_90: true,
} as const;

export async function buildMobilityPayload(
  athleteUuid: string,
  sessionDate?: string
): Promise<MobilityPayload> {
  const athlete = await prisma.d_athletes.findUnique({
    where: { athlete_uuid: athleteUuid },
    select: { athlete_uuid: true, age_group: true },
  });

  if (!athlete) {
    throw notFound("Athlete not found");
  }

  const row = await prisma.f_mobility.findFirst({
    where: {
      athlete_uuid: athleteUuid,
      ...(sessionDate ? { session_date: new Date(sessionDate) } : {}),
    },
    orderBy: { session_date: "desc" },
    select: { ...MOBILITY_SELECT, session_date: true },
  });

  if (!row) {
    throw notFound("No mobility data found for athlete");
  }

  const metrics: MobilityPayloadMetric[] = [];
  const orientation: Orientation = "HIGHER_IS_BETTER";
  const valueUnit: ValueUnit = "NUMBER";

  for (const { groupName, columns } of MOBILITY_GROUPS) {
    let groupSum = 0;
    for (const { key } of columns) {
      const val = decimalToNumber((row as MobilityRow)[key]);
      if (val !== null && Number.isFinite(val)) {
        groupSum += val;
      }
    }
    const max = MOBILITY_CATEGORY_MAX[groupName];
    const value =
      max === Number.POSITIVE_INFINITY
        ? groupSum
        : Math.min(groupSum, max);
    metrics.push({
      category: groupName,
      name: groupName,
      value: groupSum > 0 ? value : null,
      valueUnit,
      orientation,
      mobilityMetricKind: "GROUP",
      mobilityGroup: groupName,
      mobilityDisplayLabel: groupName,
      mobilityOutOf: max !== Number.POSITIVE_INFINITY ? max : null,
    });

    for (const { key, label } of columns) {
      const componentValue = decimalToNumber((row as MobilityRow)[key]);
      metrics.push({
        category: groupName,
        name: String(key),
        value: componentValue,
        valueUnit,
        orientation,
        mobilityMetricKind: "COMPONENT",
        mobilityGroup: groupName,
        mobilityDisplayLabel: label,
        mobilityOutOf: groupName === "Grip Strength" ? null : 3,
      });
    }
  }

  const sessionDateStr = row && "session_date" in row && row.session_date
    ? new Date(row.session_date as Date).toISOString().split("T")[0]
    : null;
  return {
    athleteUuid: athlete.athlete_uuid,
    level: deriveLevelFromAthlete({ age_group: athlete.age_group ?? null }),
    score: null,
    metrics,
    sessionDate: sessionDateStr,
  };
}
