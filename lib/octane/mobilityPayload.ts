import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { notFound } from "@/lib/responses";
import { deriveLevelFromAthlete } from "@/lib/octane/utils";
import { SCALE_3_COLUMNS, NON_SCORING_COLUMNS } from "@/lib/octane/mobilityColumnTypes";

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
  /** For GROUP metrics: always 100 (scores are 0–100). For COMPONENT: null. */
  mobilityOutOf?: number | null;
  /** Optimal range string for display, e.g. "80-90°". COMPONENT only. */
  mobilityOptimalRange?: string | null;
  /** 0–100 score for this component against its optimal range. COMPONENT only. */
  mobilityRangeScore?: number | null;
};

export type MobilityPayload = {
  athleteUuid: string;
  level: string;
  score: number | null;
  metrics: MobilityPayloadMetric[];
  sessionDate?: string | null;
};

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/** 9 radar groups. All GROUP metric scores are 0–100 (average of component scores). */
const MOBILITY_GROUPS: Array<{
  groupName: string;
  columns: Array<{ key: string; label: string }>;
}> = [
  {
    groupName: "Cervical",
    columns: [
      { key: "cervical_rotation_r_rom", label: "Rotation R" },
      { key: "cervical_rotation_l_rom", label: "Rotation L" },
      { key: "cervical_flexion_rom", label: "Flexion" },
      { key: "cervical_extension_rom", label: "Extension" },
      { key: "cervical_lateral_flexion_r_rom", label: "Lateral Flexion R" },
      { key: "cervical_lateral_flexion_l_rom", label: "Lateral Flexion L" },
    ],
  },
  {
    groupName: "Shoulder Mobility",
    columns: [
      { key: "horizontal_abduction_rom", label: "Horizontal Abduction" },
      { key: "back_to_wall_shoulder_flexion", label: "Back to Wall Flexion" },
      { key: "dominant_shoulder_ir", label: "Dominant IR" },
      { key: "dominant_shoulder_er", label: "Dominant ER" },
      { key: "non_dominant_shoulder_ir", label: "Non-Dom IR" },
      { key: "non_dominant_shoulder_er", label: "Non-Dom ER" },
      { key: "young_stretch_passive", label: "Young Stretch" },
    ],
  },
  {
    groupName: "Shoulder Stability",
    columns: [
      { key: "hawkins_kennedy_test", label: "Hawkins Kennedy" },
      { key: "shoulder_stability_flexion_mmt", label: "Stability Flexion" },
      { key: "shoulder_stability_abduction_mmt", label: "Stability Abduction" },
      { key: "shoulder_stability_er_at_0_deg_horiz_abduction_mmt", label: "Stability ER" },
      { key: "shoulder_stability_ir_at_0_deg_horiz_abduction_mmt", label: "Stability IR" },
      { key: "mid_trap_mmt", label: "Mid Trap" },
      { key: "low_trap_mmt", label: "Low Trap" },
      { key: "scap_winging", label: "Scap Winging" },
    ],
  },
  {
    groupName: "Elbow",
    columns: [
      { key: "elbow_extension_rom", label: "Extension" },
      { key: "elbow_flexion_rom", label: "Flexion" },
      { key: "elbow_pronation_rom", label: "Pronation" },
      { key: "elbow_supination_rom", label: "Supination" },
      { key: "radial_nerve_glide", label: "Radial Nerve Glide" },
      { key: "ulnar_nerve_glide", label: "Ulnar Nerve Glide" },
    ],
  },
  {
    groupName: "Spine / Core",
    columns: [
      { key: "pelvic_tilt_against_wall", label: "Pelvic Tilt Wall" },
      { key: "backbend", label: "Backbend" },
      { key: "sittiing_t_spine_pvc_r", label: "T-Spine PVC R" },
      { key: "sittiing_t_spine_pvc_l", label: "T-Spine PVC L" },
      { key: "slump_test", label: "Slump Test" },
      { key: "isa_rom", label: "ISA" },
    ],
  },
  {
    groupName: "Hip Mobility",
    columns: [
      { key: "thomas_test_hip_flexor_r", label: "Thomas Test R" },
      { key: "thomas_test_hip_flexor_l", label: "Thomas Test L" },
      { key: "r_hamstring_stretch_rom", label: "Hamstring R" },
      { key: "l_hamstring_stretch_rom", label: "Hamstring L" },
      { key: "r_hip_abduction_rom", label: "Hip Abduction R" },
      { key: "l_hip_abduction_rom", label: "Hip Abduction L" },
      { key: "hip_pinch", label: "Hip Pinch" },
      { key: "r_hip_flexion_rom", label: "Hip Flexion R" },
      { key: "l_hip_flexion_rom", label: "Hip Flexion L" },
      { key: "r_prone_hip_ir", label: "Prone Hip IR R" },
      { key: "r_prone_hip_er", label: "Prone Hip ER R" },
      { key: "l_prone_hip_ir", label: "Prone Hip IR L" },
      { key: "l_prone_hip_er", label: "Prone Hip ER L" },
    ],
  },
  {
    groupName: "Hip Stability",
    columns: [
      { key: "seated_r_hip_ir_mmt", label: "Seated Hip IR R" },
      { key: "seated_l_hip_ir_mmt", label: "Seated Hip IR L" },
      { key: "seated_r_hip_er_mmt", label: "Seated Hip ER R" },
      { key: "seated_l_hip_er_mmt", label: "Seated Hip ER L" },
      { key: "r_prone_hamstring_raise_mmt", label: "Hamstring Raise R" },
      { key: "l_prone_hamstring_raise_mmt", label: "Hamstring Raise L" },
      { key: "r_prone_glute_raise_mmt", label: "Glute Raise R" },
      { key: "l_prone_glute_raise_mmt", label: "Glute Raise L" },
      { key: "r_hip_abduction_mmt", label: "Hip Abduction R" },
      { key: "l_hip_adduction_mmt", label: "Hip Adduction L" },
      { key: "r_hip_adduction_mmt", label: "Hip Adduction R" },
      { key: "l_hip_abduction_mmt", label: "Hip Abduction L" },
    ],
  },
  {
    groupName: "Ankle",
    columns: [
      { key: "r_ankle_dorsiflexion_to_wall_rom", label: "Dorsiflexion R" },
      { key: "l_ankle_dorsiflexion_to_wall_rom", label: "Dorsiflexion L" },
      { key: "r_ankle_dorsiflexion_mmt", label: "Dorsiflexion MMT R" },
      { key: "r_ankle_inversion_mmt", label: "Inversion R" },
      { key: "r_ankle_eversion_mmt", label: "Eversion R" },
      { key: "l_ankle_dorsiflexion_mmt", label: "Dorsiflexion MMT L" },
      { key: "l_ankle_inversion_mmt", label: "Inversion L" },
      { key: "l_ankle_eversion_mmt", label: "Eversion L" },
    ],
  },
  {
    groupName: "Grip Strength",
    columns: [
      { key: "grip_strength_r", label: "Grip Strength R" },
      { key: "gs_l", label: "Grip Strength L" },
      { key: "grip_strength_r_at_90", label: "GS R at 90°" },
      { key: "gs_l_at_90", label: "GS L at 90°" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Override stored optimal ranges for columns whose DB value fails to parse. */
const RANGE_OVERRIDES: Record<string, string> = {};

/**
 * Hardcoded reference ranges for columns that have no stored optimal range
 * but can be reasonably scored.
 */
const FALLBACK_RANGES: Record<string, string> = {
  grip_strength_r: "> 50",
  gs_l: "> 50",
  grip_strength_r_at_90: "> 40",
  gs_l_at_90: "> 40",
  hawkins_kennedy_test: "negative",  // stored as 0=Negative(pass), 1=Positive(fail)
};

type ParsedRange =
  | { kind: "range"; min: number; max: number }
  | { kind: "min"; min: number }
  | { kind: "max"; max: number }
  | { kind: "target"; target: number }
  | { kind: "negative" };

function parseOptimalRange(rangeStr: string): ParsedRange | null {
  const s = rangeStr.trim().replace(/°/g, "").replace(/\s+/g, " ");

  if (s.toLowerCase() === "negative") return { kind: "negative" };

  // "X-Y" or "X–Y"
  const rangeMatch = s.match(/^(\d+\.?\d*)\s*[-–]\s*(\d+\.?\d*)$/);
  if (rangeMatch) {
    return { kind: "range", min: parseFloat(rangeMatch[1]), max: parseFloat(rangeMatch[2]) };
  }

  // ">= X" or "> X"
  const minMatch = s.match(/^>=?\s*(\d+\.?\d*)$/);
  if (minMatch) return { kind: "min", min: parseFloat(minMatch[1]) };

  // "<= X" or "< X"
  const maxMatch = s.match(/^<=?\s*(\d+\.?\d*)$/);
  if (maxMatch) return { kind: "max", max: parseFloat(maxMatch[1]) };

  // Bare number target (e.g. "3" for MMT)
  const numMatch = s.match(/^(\d+\.?\d*)$/);
  if (numMatch) return { kind: "target", target: parseFloat(numMatch[1]) };

  return null;
}

/** Score a value against a range string. Returns 0–100. */
function scoreAgainstRange(value: number, rangeStr: string): number {
  const parsed = parseOptimalRange(rangeStr);
  if (!parsed) return 0;

  switch (parsed.kind) {
    case "negative":
      if (value <= 1) return 100;
      if (value <= 2) return 50;
      return 0;

    case "range": {
      const { min, max } = parsed;
      if (value >= min && value <= max) return 100;
      const width = Math.max(max - min, 1);
      const dist = value < min ? min - value : value - max;
      return Math.max(0, Math.round((1 - dist / width) * 100));
    }

    case "min":
      if (value >= parsed.min) return 100;
      return Math.max(0, Math.round((value / parsed.min) * 100));

    case "max":
      if (value <= parsed.max) return 100;
      return Math.max(0, Math.round((parsed.max / value) * 100));

    case "target":
      if (value >= parsed.target) return 100;
      return Math.max(0, Math.round((value / parsed.target) * 100));
  }
}

/**
 * Score a single component. Returns 0–100, or null if the column has no
 * applicable scoring method (raw measurement with no range reference).
 */
function scoreComponent(
  key: string,
  value: number | null,
  optimalRanges: Record<string, string>
): number | null {
  if (value == null || !Number.isFinite(value)) return null;

  // 3-point scale columns: score as value / 3 — use floor for exact 33/66/100
  if (SCALE_3_COLUMNS.has(key)) {
    return Math.min(100, Math.max(0, Math.floor((value / 3) * 100)));
  }

  // T-spine PVC: tiered — <70 red, 70-79 yellow, 80+ green
  if (key === "sittiing_t_spine_pvc_r" || key === "sittiing_t_spine_pvc_l") {
    if (value >= 80) return 100;
    if (value >= 70) return 65;
    return Math.min(44, Math.round((value / 70) * 44));
  }

  // Stored range: overrides take precedence over DB-stored range, then fallback
  const rangeStr = RANGE_OVERRIDES[key] ?? optimalRanges[key] ?? FALLBACK_RANGES[key] ?? null;
  if (rangeStr) return scoreAgainstRange(value, rangeStr);

  // Force measurement columns (_mmt suffix) are dynamometer readings in lbs.
  // No reference population data available — leave unscored rather than using
  // the wrong scale.
  return null;
}

// ---------------------------------------------------------------------------
// Raw value helper
// ---------------------------------------------------------------------------

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = v as any;
  if (typeof a.toNumber === "function") return a.toNumber() as number;
  if (typeof a.toString === "function") {
    const n = Number(a.toString());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function getOrientation(key: string): Orientation {
  if (key === "elbow_extension_rom") return "LOWER_IS_BETTER";
  return "HIGHER_IS_BETTER";
}

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

export async function buildMobilityPayload(
  athleteUuid: string,
  sessionDate?: string
): Promise<MobilityPayload> {
  const athlete = await prisma.d_athletes.findUnique({
    where: { athlete_uuid: athleteUuid },
    select: { athlete_uuid: true, age_group: true },
  });

  if (!athlete) throw notFound("Athlete not found");

  // Use raw SQL so we can select dynamically-added columns that aren't in the
  // Prisma schema (the 70 measurement columns are added via ensure_column_exists
  // in the Python ingestion, not via Prisma migrations).
  const whereClause = sessionDate
    ? Prisma.sql`WHERE athlete_uuid = ${athleteUuid} AND session_date = ${new Date(sessionDate)}::date`
    : Prisma.sql`WHERE athlete_uuid = ${athleteUuid}`;

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT *
      FROM public.f_mobility
      ${whereClause}
      ORDER BY session_date DESC, created_at DESC
      LIMIT 1
    `
  );

  if (!rows.length) throw notFound("No mobility data found for athlete");

  const row = rows[0];

  // optimal_ranges is JSONB → already a JS object when returned from the driver
  const optimalRanges: Record<string, string> =
    row.optimal_ranges != null && typeof row.optimal_ranges === "object"
      ? (row.optimal_ranges as Record<string, string>)
      : {};

  const metrics: MobilityPayloadMetric[] = [];

  for (const { groupName, columns } of MOBILITY_GROUPS) {
    const componentMetrics: MobilityPayloadMetric[] = [];
    const scores: number[] = [];

    for (const { key, label } of columns) {
      const rawVal = toNumber(row[key]);
      const rangeStr = optimalRanges[key] ?? FALLBACK_RANGES[key] ?? null;
      const rangeScore = scoreComponent(key, rawVal, optimalRanges);

      if (rangeScore != null && !NON_SCORING_COLUMNS.has(key)) scores.push(rangeScore);

      componentMetrics.push({
        category: groupName,
        name: key,
        value: rawVal,
        valueUnit: "NUMBER",
        orientation: getOrientation(key),
        mobilityMetricKind: "COMPONENT",
        mobilityGroup: groupName,
        mobilityDisplayLabel: label,
        mobilityOutOf: null,
        mobilityOptimalRange: rangeStr,
        mobilityRangeScore: rangeScore,
      });
    }

    const groupScore =
      scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

    metrics.push({
      category: groupName,
      name: groupName,
      value: groupScore,
      valueUnit: "NUMBER",
      orientation: "HIGHER_IS_BETTER",
      mobilityMetricKind: "GROUP",
      mobilityGroup: groupName,
      mobilityDisplayLabel: groupName,
      mobilityOutOf: 100,
    });

    metrics.push(...componentMetrics);
  }

  const rawSessionDate = row.session_date;
  const sessionDateStr =
    rawSessionDate instanceof Date
      ? rawSessionDate.toISOString().split("T")[0]
      : typeof rawSessionDate === "string"
        ? rawSessionDate.split("T")[0]
        : null;

  return {
    athleteUuid: athlete.athlete_uuid,
    level: deriveLevelFromAthlete({ age_group: athlete.age_group ?? null }),
    score: null,
    metrics,
    sessionDate: sessionDateStr,
  };
}
