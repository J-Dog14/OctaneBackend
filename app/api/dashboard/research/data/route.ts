import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/requireAuth";
import { success, badRequest, internalError } from "@/lib/responses";
import { prisma } from "@/lib/db/prisma";
import { computeStatistics } from "@/lib/research/statistics";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DataPoint = {
  athleteUuid: string;
  athleteName: string;
  ageGroup: string | null;
  x: number;
  y: number;
};

export type ResearchDataResponse = {
  points: DataPoint[];
  xLabel: string;
  yLabel: string;
  statistics: ReturnType<typeof computeStatistics>;
};

// ─── SQL table definitions (whitelisted) ─────────────────────────────────────

/** Maps table key → actual SQL table name */
const SQL_TABLE: Record<string, string> = {
  pitching:                "f_pitching_trials",
  hitting:                 "f_hitting_trials",
  athletic_screen_cmj:     "f_athletic_screen_cmj",
  athletic_screen_dj:      "f_athletic_screen_dj",
  athletic_screen_slv:     "f_athletic_screen_slv",
  athletic_screen_nmt:     "f_athletic_screen_nmt",
  athletic_screen_ppu:     "f_athletic_screen_ppu",
  mobility:                "f_mobility",
  pro_sup:                 "f_pro_sup",
  proteus:                 "f_proteus",
  readiness_screen_cmj:    "f_readiness_screen_cmj",
  readiness_screen_i:      "f_readiness_screen_i",
  readiness_screen_ir90:   "f_readiness_screen_ir90",
  readiness_screen_ppu:    "f_readiness_screen_ppu",
  readiness_screen_t:      "f_readiness_screen_t",
  readiness_screen_y:      "f_readiness_screen_y",
};

/** Direct numeric columns per table (whitelisted — prevent column injection) */
const VALID_DIRECT_COLUMNS: Record<string, Set<string>> = {
  pitching: new Set(["velocity_mph", "score", "age_at_collection", "height", "weight"]),
  hitting:  new Set(["age_at_collection", "height", "weight"]),
  athletic_screen_cmj: new Set([
    "jh_in","peak_power","pp_forceplate","force_at_pp","vel_at_pp","pp_w_per_kg",
    "peak_power_w","time_to_peak_s","rpd_max_w_per_s","time_to_rpd_max_s",
    "rise_time_10_90_s","fwhm_s","auc_j","work_early_pct","decay_90_10_s",
    "t_com_norm_0to1","skewness","kurtosis","spectral_centroid_hz",
  ]),
  athletic_screen_dj: new Set([
    "jh_in","ct","rsi","pp_w_per_kg","peak_power_w","time_to_peak_s",
    "rpd_max_w_per_s","rise_time_10_90_s","fwhm_s","auc_j",
  ]),
  athletic_screen_slv: new Set([
    "jh_in","pp_w_per_kg","peak_power_w","time_to_peak_s","rpd_max_w_per_s","fwhm_s","auc_j",
  ]),
  athletic_screen_nmt: new Set(["num_taps_10s","num_taps_20s","num_taps_30s","num_taps"]),
  athletic_screen_ppu: new Set([
    "jh_in","peak_power","pp_w_per_kg","peak_power_w","time_to_peak_s","rpd_max_w_per_s","fwhm_s","auc_j",
  ]),
  mobility: new Set([
    "cervical_rotation","cervical_flexion","cervical_extension","cervical_lateral_flexion",
    "shoulder_total_arc","horizontal_abduction","back_to_wall_shoulder_flexion",
    "pelvic_tilt_against_wall","shoulder_ir","shoulder_er","supine_shoulder_flexion",
    "elbow_extension_rom","elbow_flexion_rom","elbow_pronation_rom","elbow_supination_rom",
    "radial_nerve_glide","ulnar_nerve_glide",
    "grip_strength","grip_strength_r","grip_strength_r_at_90",
    "hamstring_stretch","r_hip_ir","r_hip_er","l_hip_ir","l_hip_er",
    "r_prone_hip_ir","r_prone_hip_er","l_prone_hip_ir","l_prone_hip_er",
    "thomas_test_hip_flexor_r","thomas_test_hip_flexor_l",
    "ankle_dorsiflextion_to_wall","backbend","isa","age_at_collection",
  ]),
  pro_sup: new Set([
    "forearm_rom","tot_rom","avg_velo","total_score","total_fatigue_score",
    "cumulative_rom","raw_total_score","num_of_flips",
    "forearm_rom_0to10","forearm_rom_10to20","forearm_rom_20to30",
    "tot_rom_0to10","tot_rom_10to20","tot_rom_20to30",
    "avg_velo_0_10","avg_velo_10_20","avg_velo_20_30",
    "num_of_flips_0_10","num_of_flips_10_20","num_of_flips_20_30",
    "fatigue_index_10","fatigue_index_20","fatigue_index_30",
    "consistency_penalty","age_at_collection","height","weight",
  ]),
  proteus: new Set([
    "power_mean","power_high","power_low",
    "velocity_mean","velocity_high","velocity_low",
    "acceleration_mean","acceleration_high","acceleration_low",
    "braking_mean","braking_high","braking_low",
    "deceleration_mean","deceleration_high","deceleration_low",
    "explosiveness_mean","explosiveness_high","explosiveness_low",
    "range_of_motion_mean","range_of_motion_high","range_of_motion_low",
    "consistency_mean","consistency_high","consistency_low",
    "age_at_collection",
  ]),
  readiness_screen_cmj: new Set([
    "jump_height","peak_power","peak_force","pp_w_per_kg","pp_forceplate","force_at_pp","vel_at_pp",
  ]),
  readiness_screen_i:   new Set(["avg_force","avg_force_norm","max_force","max_force_norm","time_to_max"]),
  readiness_screen_ir90:new Set(["avg_force","avg_force_norm","max_force","max_force_norm","time_to_max"]),
  readiness_screen_ppu: new Set([
    "jump_height","peak_power","peak_force","pp_w_per_kg","pp_forceplate","force_at_pp","vel_at_pp",
  ]),
  readiness_screen_t:   new Set(["avg_force","avg_force_norm","max_force","max_force_norm","time_to_max"]),
  readiness_screen_y:   new Set(["avg_force","avg_force_norm","max_force","max_force_norm","time_to_max"]),
};

/** Tables that support JSONB metrics field */
const HAS_JSONB = new Set(["pitching", "hitting"]);

// ─── Group mapping ────────────────────────────────────────────────────────────

const GROUP_SQL_MAP: Record<string, string> = {
  pro:         "Pro",
  college:     "College",
  high_school: "High School",
  softball:    "Softball",
};

// ─── Build per-variable CTE SQL ───────────────────────────────────────────────

/** Tables that support movement filtering (f_proteus.movement column) */
const HAS_MOVEMENT = new Set(["proteus"]);

type VarSpec = {
  tableKey: string;
  variableKey: string;
  aggregation: "byAthlete" | "bySession" | "byTrial" | "byRound";
  movement?: string; // only for tables in HAS_MOVEMENT
};

/**
 * Build a CTE fragment that produces (trial_id, athlete_uuid, session_date, round_num, value).
 * byTrial  — one row per individual trial, joined by trial id (t.id)
 * bySession — one row per athlete+session, joined by athlete+date
 * byRound  — one row per athlete+assessment-round (sessions within 14 days grouped together)
 * byAthlete — one row per athlete
 */
function buildValueCTE(
  alias: string,
  spec: VarSpec,
  ageGroups: string[] | null,
  athleteUuids: string[] | null,
  paramOffset: number,
): { sql: string; params: unknown[]; nextOffset: number } {
  const sqlTable = SQL_TABLE[spec.tableKey]!;
  const isJsonb  = spec.variableKey.startsWith("jsonb:");
  const params: unknown[] = [];
  let pIdx = paramOffset;

  // Raw value expression
  let rawValueExpr: string;
  if (isJsonb) {
    const jsonKey = spec.variableKey.slice("jsonb:".length);
    if (jsonKey.length > 200 || /['"`;\\]/.test(jsonKey)) throw new Error("Invalid JSONB key");
    const safeKey = jsonKey.replace(/'/g, "''");
    rawValueExpr = `CASE WHEN jsonb_typeof(t.metrics::jsonb->'${safeKey}') = 'array' THEN (t.metrics::jsonb->'${safeKey}'->0)::text::numeric ELSE (t.metrics::jsonb->>'${safeKey}')::numeric END`;
  } else {
    if (!VALID_DIRECT_COLUMNS[spec.tableKey]?.has(spec.variableKey)) {
      throw new Error(`Invalid column "${spec.variableKey}" for table "${spec.tableKey}"`);
    }
    rawValueExpr = `t."${spec.variableKey}"::numeric`;
  }

  // WHERE conditions (used for byTrial; aggregate modes drop the IS NOT NULL to HAVING)
  const conditions: string[] = [
    `${rawValueExpr} IS NOT NULL`,
    `${rawValueExpr} != 0`,
  ];
  if (spec.movement && HAS_MOVEMENT.has(spec.tableKey)) {
    conditions.push(`t.movement ILIKE $${pIdx++}`);
    params.push(spec.movement);
  }
  if (ageGroups && ageGroups.length > 0) {
    conditions.push(`da.age_group = ANY($${pIdx++}::text[])`);
    params.push(ageGroups);
  }
  if (athleteUuids && athleteUuids.length > 0) {
    conditions.push(`t.athlete_uuid = ANY($${pIdx++}::text[])`);
    params.push(athleteUuids);
  }

  // For aggregate modes, the IS NOT NULL goes in HAVING; other conditions remain in WHERE
  const aggConditions = conditions.slice(1);
  const aggWhere = aggConditions.length > 0 ? `WHERE ${aggConditions.join(" AND ")}` : "";
  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  let sql: string;

  if (spec.aggregation === "byTrial") {
    sql = `
${alias} AS (
  SELECT
    t.id                  AS trial_id,
    t.athlete_uuid,
    t.session_date,
    NULL::integer         AS round_num,
    ${rawValueExpr}       AS value
  FROM "${sqlTable}" t
  JOIN analytics.d_athletes da ON da.athlete_uuid = t.athlete_uuid
  ${whereClause}
)`;
  } else if (spec.aggregation === "byRound") {
    // Group sessions within each table into assessment rounds using a 14-day proximity window.
    // Sessions within 14 days of each other (per athlete) share the same round number.
    // Joining x and y by (athlete_uuid, round_num) pairs assessments from the same period
    // without requiring exact date matches across different tables.
    sql = `
${alias} AS (
  SELECT
    NULL::integer         AS trial_id,
    t.athlete_uuid,
    MIN(sr.session_date)  AS session_date,
    sr.round_num,
    AVG(${rawValueExpr})  AS value
  FROM "${sqlTable}" t
  JOIN (
    SELECT athlete_uuid, session_date,
      SUM(CASE
        WHEN session_date - LAG(session_date) OVER (PARTITION BY athlete_uuid ORDER BY session_date) > 14
          OR LAG(session_date) OVER (PARTITION BY athlete_uuid ORDER BY session_date) IS NULL
        THEN 1 ELSE 0
      END) OVER (PARTITION BY athlete_uuid ORDER BY session_date)::integer AS round_num
    FROM (SELECT DISTINCT athlete_uuid, session_date FROM "${sqlTable}" WHERE athlete_uuid IS NOT NULL) s
  ) sr ON sr.athlete_uuid = t.athlete_uuid AND sr.session_date = t.session_date
  JOIN analytics.d_athletes da ON da.athlete_uuid = t.athlete_uuid
  ${aggWhere}
  GROUP BY t.athlete_uuid, sr.round_num
  HAVING AVG(${rawValueExpr}) IS NOT NULL AND AVG(${rawValueExpr}) != 0
)`;
  } else {
    // byAthlete or bySession
    const valueExpr  = `AVG(${rawValueExpr})`;
    const groupBy    = spec.aggregation === "bySession" ? "t.athlete_uuid, t.session_date" : "t.athlete_uuid";
    const selectCols = spec.aggregation === "bySession"
      ? "t.athlete_uuid, t.session_date,"
      : "t.athlete_uuid, NULL::date AS session_date,";

    sql = `
${alias} AS (
  SELECT
    NULL::integer         AS trial_id,
    ${selectCols}
    NULL::integer         AS round_num,
    ${valueExpr}          AS value
  FROM "${sqlTable}" t
  JOIN analytics.d_athletes da ON da.athlete_uuid = t.athlete_uuid
  ${aggWhere}
  GROUP BY ${groupBy}
  HAVING ${valueExpr} IS NOT NULL
)`;
  }

  return { sql, params, nextOffset: pIdx };
}

// ─── Label formatter ──────────────────────────────────────────────────────────

function formatVarLabel(variable: string, isJsonb: boolean): string {
  const raw = isJsonb ? variable.slice("jsonb:".length) : variable;
  return raw.replace(/_/g, " ");
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * GET /api/dashboard/research/data
 *   ?xTable=pitching&xVariable=velocity_mph
 *   &yTable=athletic_screen_cmj&yVariable=jh_in
 *   &groups=college,high_school          (comma-separated; empty = all groups)
 *   &aggregation=byTrial                 (byAthlete | bySession | byTrial | byRound)
 *   &athleteUuids=uuid1,uuid2            (optional)
 */
export async function GET(request: NextRequest) {
  await requireAuth();
  const sp = new URL(request.url).searchParams;

  const xTable       = sp.get("xTable") ?? "";
  const xVariable    = sp.get("xVariable") ?? "";
  const yTable       = sp.get("yTable") ?? "";
  const yVariable    = sp.get("yVariable") ?? "";
  const groupsParam  = sp.get("groups") ?? "";
  const aggParam     = sp.get("aggregation") ?? "byAthlete";
  const uuidsParam   = sp.get("athleteUuids");
  const xMovement    = sp.get("xMovement") ?? undefined;
  const yMovement    = sp.get("yMovement") ?? undefined;

  if (!SQL_TABLE[xTable]) return badRequest(`Unknown xTable: ${xTable}`);
  if (!SQL_TABLE[yTable]) return badRequest(`Unknown yTable: ${yTable}`);
  if (!xVariable)         return badRequest("xVariable is required");
  if (!yVariable)         return badRequest("yVariable is required");

  if (!["byAthlete", "bySession", "byTrial", "byRound"].includes(aggParam)) {
    return badRequest("aggregation must be byAthlete, bySession, byTrial, or byRound");
  }
  const aggregation = aggParam as "byAthlete" | "bySession" | "byTrial" | "byRound";

  if (aggParam === "byTrial" && xTable !== yTable) {
    return badRequest("byTrial aggregation requires both variables from the same table");
  }

  // Parse comma-separated group keys → SQL values (invalid keys are silently ignored)
  const parsedGroups = groupsParam
    .split(",")
    .filter((g) => g in GROUP_SQL_MAP)
    .map((g) => GROUP_SQL_MAP[g]!);
  const ageGroups: string[] | null = parsedGroups.length > 0 ? parsedGroups : null;

  const athleteUuids = uuidsParam ? uuidsParam.split(",").filter(Boolean) : null;

  const xIsJsonb = xVariable.startsWith("jsonb:");
  const yIsJsonb = yVariable.startsWith("jsonb:");
  if (!xIsJsonb && !VALID_DIRECT_COLUMNS[xTable]?.has(xVariable)) {
    return badRequest(`Invalid xVariable "${xVariable}" for table "${xTable}"`);
  }
  if (!yIsJsonb && !VALID_DIRECT_COLUMNS[yTable]?.has(yVariable)) {
    return badRequest(`Invalid yVariable "${yVariable}" for table "${yTable}"`);
  }
  if (xIsJsonb && !HAS_JSONB.has(xTable)) {
    return badRequest(`Table "${xTable}" does not support JSONB metrics`);
  }
  if (yIsJsonb && !HAS_JSONB.has(yTable)) {
    return badRequest(`Table "${yTable}" does not support JSONB metrics`);
  }

  try {
    let offset = 1;
    const xSpec: VarSpec = { tableKey: xTable, variableKey: xVariable, aggregation, movement: xMovement };
    const ySpec: VarSpec = { tableKey: yTable, variableKey: yVariable, aggregation, movement: yMovement };

    const xCTE = buildValueCTE("x_cte", xSpec, ageGroups, athleteUuids, offset);
    offset = xCTE.nextOffset;
    const yCTE = buildValueCTE("y_cte", ySpec, ageGroups, athleteUuids, offset);

    const joinCondition =
      aggregation === "byTrial"   ? "x_cte.trial_id = y_cte.trial_id" :
      aggregation === "bySession" ? "x_cte.athlete_uuid = y_cte.athlete_uuid AND ABS(x_cte.session_date - y_cte.session_date) <= 7" :
      aggregation === "byRound"   ? "x_cte.athlete_uuid = y_cte.athlete_uuid AND ABS(x_cte.session_date - y_cte.session_date) <= 30" :
                                    "x_cte.athlete_uuid = y_cte.athlete_uuid";

    const sql = `
WITH
${xCTE.sql},
${yCTE.sql}
SELECT
  x_cte.athlete_uuid,
  da.name AS athlete_name,
  da.age_group,
  x_cte.value AS x,
  y_cte.value AS y
FROM x_cte
JOIN y_cte ON ${joinCondition}
JOIN analytics.d_athletes da ON da.athlete_uuid = x_cte.athlete_uuid
ORDER BY da.name
LIMIT 10000`;

    const allParams = [...xCTE.params, ...yCTE.params];

    type RawRow = {
      athlete_uuid: string;
      athlete_name: string;
      age_group: string | null;
      x: string | number;
      y: string | number;
    };

    const rows = await prisma.$queryRawUnsafe<RawRow[]>(sql, ...allParams);

    const points: DataPoint[] = rows
      .map((r) => ({
        athleteUuid: r.athlete_uuid,
        athleteName: r.athlete_name,
        ageGroup:    r.age_group ?? null,
        x: typeof r.x === "string" ? parseFloat(r.x) : Number(r.x),
        y: typeof r.y === "string" ? parseFloat(r.y) : Number(r.y),
      }))
      .filter((p) => isFinite(p.x) && isFinite(p.y));

    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const statistics = computeStatistics(xs, ys);

    const xLabel = formatVarLabel(xVariable, xIsJsonb);
    const yLabel = formatVarLabel(yVariable, yIsJsonb);

    return success({ points, xLabel, yLabel, statistics } satisfies ResearchDataResponse);
  } catch (err) {
    console.error("[research/data] error:", err);
    const msg = err instanceof Error ? err.message : "Failed to fetch research data";
    return internalError(msg);
  }
}
