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
  pitching:            "f_pitching_trials",
  hitting:             "f_hitting_trials",
  athletic_screen_cmj: "f_athletic_screen_cmj",
  athletic_screen_dj:  "f_athletic_screen_dj",
  athletic_screen_slv: "f_athletic_screen_slv",
  athletic_screen_nmt: "f_athletic_screen_nmt",
  athletic_screen_ppu: "f_athletic_screen_ppu",
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
};

/** Tables that support JSONB metrics field */
const HAS_JSONB = new Set(["pitching", "hitting"]);

// ─── Group → SQL condition ────────────────────────────────────────────────────

const GROUP_FILTERS: Record<string, string | null> = {
  all:         null,
  pro:         "Pro",
  college:     "College",
  high_school: "High School",
  softball:    "Softball",
};

// ─── Build per-variable CTE SQL ───────────────────────────────────────────────

type VarSpec = {
  tableKey: string;
  variableKey: string; // "jsonb:METRIC_KEY" or direct column
  aggregation: "byAthlete" | "bySession" | "byTrial";
};

type BuildCTEResult = {
  sql: string;
  bindValues: (string | string[])[]; // positional params for $queryRaw
  paramOffset: number;
};

/**
 * Build a CTE fragment that produces (athlete_uuid, session_date?, value).
 * Returns the SQL text and an array of bind values to append.
 * paramOffset: the current $N index (1-based Prisma raw param).
 */
function buildValueCTE(
  alias: string,
  spec: VarSpec,
  ageGroup: string | null,
  athleteUuids: string[] | null,
  paramOffset: number,
): { sql: string; params: unknown[]; nextOffset: number } {
  const sqlTable = SQL_TABLE[spec.tableKey];
  const isJsonb  = spec.variableKey.startsWith("jsonb:");
  const params: unknown[] = [];
  let pIdx = paramOffset;

  // Determine raw value expression (single row, no aggregation)
  let rawValueExpr: string;
  if (isJsonb) {
    const jsonKey = spec.variableKey.slice("jsonb:".length);
    if (jsonKey.length > 200 || /['"`;\\]/.test(jsonKey)) {
      throw new Error("Invalid JSONB key");
    }
    // Some pitching/hitting metrics are stored as single-element JSON arrays
    // e.g. [14.2929] instead of 14.2929. Handle both cases:
    //   • array  → take index 0 element as text, cast to numeric
    //   • number → extract as text with ->>, cast to numeric
    const safeKey = jsonKey.replace(/'/g, "''");
    rawValueExpr = `
      CASE
        WHEN jsonb_typeof(t.metrics::jsonb->'${safeKey}') = 'array'
        THEN (t.metrics::jsonb->'${safeKey}'->0)::text::numeric
        ELSE (t.metrics::jsonb->>'${safeKey}')::numeric
      END`.trim();
  } else {
    if (!VALID_DIRECT_COLUMNS[spec.tableKey]?.has(spec.variableKey)) {
      throw new Error(`Invalid column "${spec.variableKey}" for table "${spec.tableKey}"`);
    }
    rawValueExpr = `t."${spec.variableKey}"::numeric`;
  }

  // WHERE conditions
  const conditions: string[] = [`${rawValueExpr} IS NOT NULL`];

  if (ageGroup !== null) {
    conditions.push(`da.age_group = $${pIdx++}`);
    params.push(ageGroup);
  }
  if (athleteUuids && athleteUuids.length > 0) {
    conditions.push(`t.athlete_uuid = ANY($${pIdx++}::text[])`);
    params.push(athleteUuids);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  let sql: string;

  if (spec.aggregation === "byTrial") {
    // One row per individual trial — include row id for joining when same table
    sql = `
${alias} AS (
  SELECT
    t.id                  AS trial_id,
    t.athlete_uuid,
    t.session_date,
    ${rawValueExpr}       AS value
  FROM "${sqlTable}" t
  JOIN analytics.d_athletes da ON da.athlete_uuid = t.athlete_uuid
  ${whereClause}
)`;
  } else {
    // Aggregate by athlete or session
    const valueExpr = `AVG(${rawValueExpr})`;
    const groupBy    = spec.aggregation === "bySession"
      ? "t.athlete_uuid, t.session_date"
      : "t.athlete_uuid";
    const selectCols = spec.aggregation === "bySession"
      ? "t.athlete_uuid, t.session_date,"
      : "t.athlete_uuid, NULL::date AS session_date,";

    // Remove the IS NOT NULL from WHERE (it's in HAVING for aggregated)
    const aggConditions = conditions.slice(1); // drop the IS NOT NULL check
    const aggWhere = aggConditions.length > 0
      ? `WHERE ${aggConditions.join(" AND ")}`
      : "";

    sql = `
${alias} AS (
  SELECT
    NULL::integer         AS trial_id,
    ${selectCols}
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

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * GET /api/dashboard/research/data
 *   ?xTable=pitching&xVariable=velocity_mph
 *   &yTable=athletic_screen_cmj&yVariable=jh_in
 *   &group=all
 *   &aggregation=byAthlete   (byAthlete | bySession)
 *   &athleteUuids=uuid1,uuid2  (optional)
 */
export async function GET(request: NextRequest) {
  await requireAuth();
  const sp = new URL(request.url).searchParams;

  const xTable       = sp.get("xTable") ?? "";
  const xVariable    = sp.get("xVariable") ?? "";
  const yTable       = sp.get("yTable") ?? "";
  const yVariable    = sp.get("yVariable") ?? "";
  const groupParam   = sp.get("group") ?? "all";
  const aggParam     = sp.get("aggregation") ?? "byAthlete";
  const uuidsParam   = sp.get("athleteUuids");

  // ── Validation ──────────────────────────────────────────────────────────
  if (!SQL_TABLE[xTable]) return badRequest(`Unknown xTable: ${xTable}`);
  if (!SQL_TABLE[yTable]) return badRequest(`Unknown yTable: ${yTable}`);
  if (!xVariable)         return badRequest("xVariable is required");
  if (!yVariable)         return badRequest("yVariable is required");

  if (!["byAthlete", "bySession", "byTrial"].includes(aggParam)) {
    return badRequest("aggregation must be byAthlete, bySession, or byTrial");
  }
  const aggregation = aggParam as "byAthlete" | "bySession" | "byTrial";

  // byTrial only valid when both variables come from the same table
  if (aggParam === "byTrial" && xTable !== yTable) {
    return badRequest("byTrial aggregation requires both variables from the same table");
  }

  if (!(groupParam in GROUP_FILTERS)) {
    return badRequest(`Unknown group: ${groupParam}. Valid: ${Object.keys(GROUP_FILTERS).join(", ")}`);
  }
  const ageGroup    = GROUP_FILTERS[groupParam];
  const athleteUuids = uuidsParam ? uuidsParam.split(",").filter(Boolean) : null;

  // Validate variable keys against whitelists
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
    // ── Build CTEs ────────────────────────────────────────────────────────
    let offset = 1;
    const xSpec: VarSpec = { tableKey: xTable, variableKey: xVariable, aggregation };
    const ySpec: VarSpec = { tableKey: yTable, variableKey: yVariable, aggregation };

    const xCTE = buildValueCTE("x_cte", xSpec, ageGroup, athleteUuids, offset);
    offset = xCTE.nextOffset;
    const yCTE = buildValueCTE("y_cte", ySpec, ageGroup, athleteUuids, offset);
    offset = yCTE.nextOffset;

    const joinCondition = aggregation === "byTrial"
      ? "x_cte.trial_id = y_cte.trial_id"
      : aggregation === "bySession"
        ? "x_cte.athlete_uuid = y_cte.athlete_uuid AND x_cte.session_date = y_cte.session_date"
        : "x_cte.athlete_uuid = y_cte.athlete_uuid";

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

    const xLabel = xIsJsonb ? xVariable.slice("jsonb:".length) : xVariable;
    const yLabel = yIsJsonb ? yVariable.slice("jsonb:".length) : yVariable;

    return success({ points, xLabel, yLabel, statistics } satisfies ResearchDataResponse);
  } catch (err) {
    console.error("[research/data] error:", err);
    const msg = err instanceof Error ? err.message : "Failed to fetch research data";
    return internalError(msg);
  }
}
