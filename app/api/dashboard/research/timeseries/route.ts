import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/requireAuth";
import { success, badRequest, internalError } from "@/lib/responses";
import { prisma } from "@/lib/db/prisma";

export type TimeSeriesPoint = { frame: number; value: number };

export type TimeSeriesSeries = {
  /** Identifies the series — athlete name, or "LabelName — AthleteName" for multi-label */
  seriesKey: string;
  athleteUuid: string;
  athleteName: string;
  ageGroup: string | null;
  metricName: string; // the label name selected by the user
  /** null = scalar value; "x"/"y"/"z" = one component of a 3-D vector */
  component: "x" | "y" | "z" | null;
  data: TimeSeriesPoint[];
  sessionDate?: string;
};

// ─── Table configs ─────────────────────────────────────────────────────────────

/**
 * All 3D time-series tables share the same structure:
 *   - a label/name column (JSONB array of strings)
 *   - a data column (JSONB array of frames; each frame is an array of values per label)
 *
 * f_pitching_force_data has no label column — fx/fy/fz are synthetic constant labels.
 */
type TableConfig = {
  sqlTable: string;
  labelsExpr: string;  // SQL expression yielding the labels JSONB array
  framesExpr: string;  // SQL expression yielding the frames JSONB array
  baseWhere: string;   // Base WHERE conditions to ensure the data exists
};

const TABLE_CONFIGS: Record<string, TableConfig> = {
  pitching_force: {
    sqlTable:   "f_pitching_force_data",
    labelsExpr: "'[\"fx\",\"fy\",\"fz\"]'::jsonb",
    framesExpr: "t.data",
    baseWhere:  "t.data IS NOT NULL",
  },
  pitching_markers: {
    sqlTable:   "f_pitching_marker_data",
    labelsExpr: "t.label_names",
    framesExpr: "t.data",
    baseWhere:  "t.label_names IS NOT NULL AND t.data IS NOT NULL",
  },
  pitching_segment_pos: {
    sqlTable:   "f_pitching_segment_pos_data",
    labelsExpr: "t.segment_names",
    framesExpr: "t.data",
    baseWhere:  "t.segment_names IS NOT NULL AND t.data IS NOT NULL",
  },
  pitching_segment_rot: {
    sqlTable:   "f_pitching_segment_rot_data",
    labelsExpr: "t.segment_names",
    framesExpr: "t.data",
    baseWhere:  "t.segment_names IS NOT NULL AND t.data IS NOT NULL",
  },
  hitting_markers: {
    sqlTable:   "f_hitting_marker_data",
    labelsExpr: "t.label_names",
    framesExpr: "t.data",
    baseWhere:  "t.label_names IS NOT NULL AND t.data IS NOT NULL",
  },
  hitting_segment_pos: {
    sqlTable:   "f_hitting_segment_pos_data",
    labelsExpr: "t.segment_names",
    framesExpr: "t.data",
    baseWhere:  "t.segment_names IS NOT NULL AND t.data IS NOT NULL",
  },
  hitting_segment_rot: {
    sqlTable:   "f_hitting_segment_rot_data",
    labelsExpr: "t.segment_names",
    framesExpr: "t.data",
    baseWhere:  "t.segment_names IS NOT NULL AND t.data IS NOT NULL",
  },
};

const VALID_TS_TABLES = new Set(Object.keys(TABLE_CONFIGS));

const GROUP_MAP: Record<string, string | null> = {
  all:         null,
  pro:         "Pro",
  college:     "College",
  high_school: "High School",
  softball:    "Softball",
};

function validateLabelName(name: string): boolean {
  return name.length > 0 && name.length <= 200 && !/['"`;\\\n\r\t]/.test(name);
}

/**
 * GET /api/dashboard/research/timeseries
 *
 * mode=labels  — returns distinct variable (label) names available in the table
 *   ?table=pitching
 *
 * mode=data    — returns time series for the selected label(s)
 *   ?table=pitching
 *   &labelNames=LabelA,LabelB   (comma-separated, 1–8 labels)
 *   &group=all
 *   &avgMode=byAthlete | bySessions | byTrial
 *   &athleteUuids=uuid1,uuid2   (optional, max 30)
 *
 * Frame data structure:
 *   frames is a JSON array of frames. Each frame element at index [labelIdx] can be:
 *   - a number   → used directly as the y-value
 *   - [x, y, z]  → 3-D coordinates; magnitude = sqrt(x²+y²+z²) is used as the y-value
 *   Frames beyond index 999 are skipped.
 */
export async function GET(request: NextRequest) {
  await requireAuth();
  const sp    = new URL(request.url).searchParams;
  const table = sp.get("table") ?? "";
  const mode  = sp.get("mode")  ?? "data";

  if (!VALID_TS_TABLES.has(table)) {
    return badRequest(`Unknown table "${table}". Valid: ${[...VALID_TS_TABLES].join(", ")}`);
  }

  const cfg = TABLE_CONFIGS[table];

  // ── mode=labels: distinct label names ──────────────────────────────────────
  if (mode === "labels") {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ label_name: string }>>(
        `SELECT DISTINCT label_text AS label_name
         FROM (
           SELECT ${cfg.labelsExpr} AS labels
           FROM "${cfg.sqlTable}" t
           WHERE ${cfg.baseWhere}
           LIMIT 20
         ) samples,
         jsonb_array_elements_text(samples.labels) AS label_text
         ORDER BY label_text
         LIMIT 500`
      );
      return success({ labels: rows.map((r) => r.label_name) });
    } catch (err) {
      console.error("[research/timeseries] labels error:", err);
      return internalError("Failed to fetch label names");
    }
  }

  // ── mode=data: time series for selected label(s) ──────────────────────────
  const labelNamesParam = sp.get("labelNames") ?? sp.get("metricNames") ?? "";
  const labelNames = labelNamesParam.split(",").map((s) => s.trim()).filter(Boolean);

  if (labelNames.length === 0) return badRequest("labelNames is required");
  if (labelNames.length > 8)   return badRequest("Maximum 8 labels at once");
  if (labelNames.some((m) => !validateLabelName(m))) return badRequest("Invalid labelName");

  const groupParam   = sp.get("group")   ?? "all";
  const uuidsParam   = sp.get("athleteUuids");
  const avgMode      = sp.get("avgMode") ?? "byAthlete";

  if (!(groupParam in GROUP_MAP)) return badRequest(`Unknown group: ${groupParam}`);
  if (!["byAthlete", "bySessions", "byTrial"].includes(avgMode)) {
    return badRequest("avgMode must be byAthlete, bySessions, or byTrial");
  }

  const ageGroup     = GROUP_MAP[groupParam];
  const athleteUuids = uuidsParam ? uuidsParam.split(",").filter(Boolean).slice(0, 30) : null;

  try {
    const allSeries: TimeSeriesSeries[] = [];

    for (const labelName of labelNames) {
      const params: unknown[] = [labelName];
      let pIdx = 2;
      const extraConditions: string[] = [];

      if (ageGroup !== null) {
        extraConditions.push(`da.age_group = $${pIdx++}`);
        params.push(ageGroup);
      }
      if (athleteUuids && athleteUuids.length > 0) {
        extraConditions.push(`t.athlete_uuid = ANY($${pIdx++}::text[])`);
        params.push(athleteUuids);
      }

      const extraWhere = extraConditions.length > 0
        ? "AND " + extraConditions.join(" AND ")
        : "";

      // Limit trials before expanding frames to control query cost
      const trialsLimit = avgMode === "byTrial" ? "50" : "100";

      // Extract scalar OR x/y/z components — never collapse vectors into magnitude
      const elemExpr = `tr.frames -> gi.frame_idx -> tr.label_idx`;
      const valScalarExpr = `CASE WHEN jsonb_typeof(${elemExpr}) = 'number' THEN (${elemExpr})::text::numeric ELSE NULL END`;
      const valXExpr      = `CASE WHEN jsonb_typeof(${elemExpr}) = 'array'  THEN (${elemExpr} -> 0)::text::numeric ELSE NULL END`;
      const valYExpr      = `CASE WHEN jsonb_typeof(${elemExpr}) = 'array'  THEN (${elemExpr} -> 1)::text::numeric ELSE NULL END`;
      const valZExpr      = `CASE WHEN jsonb_typeof(${elemExpr}) = 'array'  THEN (${elemExpr} -> 2)::text::numeric ELSE NULL END`;

      // Final SELECT depends on avgMode
      let finalSelect: string;
      if (avgMode === "byTrial") {
        finalSelect = `
SELECT rv.athlete_uuid, rv.athlete_name, rv.age_group,
       rv.session_date, rv.trial_index, rv.frame,
       rv.val_scalar, rv.val_x, rv.val_y, rv.val_z
FROM raw_vals rv
WHERE rv.val_scalar IS NOT NULL OR rv.val_x IS NOT NULL
ORDER BY rv.athlete_name, rv.session_date, rv.trial_index, rv.frame
LIMIT 200000`;
      } else if (avgMode === "bySessions") {
        finalSelect = `
SELECT rv.athlete_uuid, rv.athlete_name, rv.age_group,
       rv.session_date, NULL::integer AS trial_index, rv.frame,
       AVG(rv.val_scalar) AS val_scalar,
       AVG(rv.val_x) AS val_x, AVG(rv.val_y) AS val_y, AVG(rv.val_z) AS val_z
FROM raw_vals rv
WHERE rv.val_scalar IS NOT NULL OR rv.val_x IS NOT NULL
GROUP BY rv.athlete_uuid, rv.athlete_name, rv.age_group, rv.session_date, rv.frame
ORDER BY rv.athlete_name, rv.session_date, rv.frame
LIMIT 200000`;
      } else {
        // byAthlete
        finalSelect = `
SELECT rv.athlete_uuid, rv.athlete_name, rv.age_group,
       NULL::text AS session_date, NULL::integer AS trial_index, rv.frame,
       AVG(rv.val_scalar) AS val_scalar,
       AVG(rv.val_x) AS val_x, AVG(rv.val_y) AS val_y, AVG(rv.val_z) AS val_z
FROM raw_vals rv
WHERE rv.val_scalar IS NOT NULL OR rv.val_x IS NOT NULL
GROUP BY rv.athlete_uuid, rv.athlete_name, rv.age_group, rv.frame
ORDER BY rv.athlete_name, rv.frame
LIMIT 200000`;
      }

      const sql = `
WITH trials AS (
  SELECT
    t.athlete_uuid,
    da.name          AS athlete_name,
    da.age_group,
    t.session_date::text AS session_date,
    t.trial_index,
    label_idx_sub.idx    AS label_idx,
    jsonb_array_length(${cfg.framesExpr}) AS n_frames,
    ${cfg.framesExpr}    AS frames
  FROM "${cfg.sqlTable}" t
  CROSS JOIN LATERAL (
    SELECT (ordinality::int - 1) AS idx
    FROM jsonb_array_elements_text(${cfg.labelsExpr}) WITH ORDINALITY
    WHERE value = $1
    LIMIT 1
  ) label_idx_sub
  JOIN analytics.d_athletes da ON da.athlete_uuid = t.athlete_uuid
  WHERE ${cfg.baseWhere}
    ${extraWhere}
  ORDER BY da.name, t.session_date, t.trial_index
  LIMIT ${trialsLimit}
),
raw_vals AS (
  SELECT
    tr.athlete_uuid, tr.athlete_name, tr.age_group,
    tr.session_date, tr.trial_index,
    gi.frame_idx AS frame,
    ${valScalarExpr} AS val_scalar,
    ${valXExpr}      AS val_x,
    ${valYExpr}      AS val_y,
    ${valZExpr}      AS val_z
  FROM trials tr
  CROSS JOIN LATERAL generate_series(0, LEAST(tr.n_frames - 1, 999)) AS gi(frame_idx)
)
${finalSelect}`;

      type RawRow = {
        athlete_uuid: string;
        athlete_name: string;
        age_group: string | null;
        session_date: string | null;
        trial_index: number | string | null;
        frame: number | string;
        val_scalar: number | string | null;
        val_x: number | string | null;
        val_y: number | string | null;
        val_z: number | string | null;
      };

      const rows = await prisma.$queryRawUnsafe<RawRow[]>(sql, ...params);

      const toNum = (v: number | string | null | undefined): number | null => {
        if (v == null) return null;
        const n = typeof v === "string" ? parseFloat(v) : Number(v);
        return isFinite(n) ? n : null;
      };

      // Group rows into per-series objects — scalar gets 1 series, vector gets 3 (x/y/z)
      const seriesMap = new Map<string, TimeSeriesSeries>();

      const getOrCreate = (
        sk: string,
        uuid: string,
        name: string,
        ageGroup: string | null,
        sessionDate: string | null,
        component: "x" | "y" | "z" | null,
      ): TimeSeriesSeries => {
        if (!seriesMap.has(sk)) {
          seriesMap.set(sk, {
            seriesKey:   sk,
            athleteUuid: uuid,
            athleteName: name,
            ageGroup,
            metricName:  labelName,
            component,
            data:        [],
            sessionDate: sessionDate ?? undefined,
          });
        }
        return seriesMap.get(sk)!;
      };

      for (const row of rows) {
        let baseKey: string;
        if (avgMode === "byTrial") {
          baseKey = `${row.athlete_name} (${row.session_date} #${row.trial_index})`;
        } else if (avgMode === "bySessions") {
          baseKey = `${row.athlete_name} (${row.session_date})`;
        } else {
          baseKey = row.athlete_name;
        }
        const labelPrefix = labelNames.length > 1 ? `${labelName} — ` : "";
        const frame = toNum(row.frame as number | string);
        if (frame === null) continue;

        const scalar = toNum(row.val_scalar);
        if (scalar !== null) {
          const sk = `${labelPrefix}${baseKey}`;
          getOrCreate(sk, row.athlete_uuid, row.athlete_name, row.age_group ?? null, row.session_date, null)
            .data.push({ frame, value: scalar });
        } else {
          const vx = toNum(row.val_x);
          const vy = toNum(row.val_y);
          const vz = toNum(row.val_z);
          for (const [comp, v] of [["x", vx], ["y", vy], ["z", vz]] as const) {
            if (v === null) continue;
            const sk = `${labelPrefix}${baseKey} [${comp}]`;
            getOrCreate(sk, row.athlete_uuid, row.athlete_name, row.age_group ?? null, row.session_date, comp)
              .data.push({ frame, value: v });
          }
        }
      }

      allSeries.push(...seriesMap.values());
    }

    // Cap series count for rendering performance
    const series = allSeries.slice(0, 60);
    return success({ series, labelNames, metricNames: labelNames });
  } catch (err) {
    console.error("[research/timeseries] data error:", err);
    const msg = err instanceof Error ? err.message : "Failed to fetch time series data";
    return internalError(msg);
  }
}
