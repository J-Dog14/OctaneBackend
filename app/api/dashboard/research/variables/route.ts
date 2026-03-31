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
    { key: "velocity_mph",      label: "Velocity (mph)",            isJsonb: false, group: "Direct" },
    { key: "score",             label: "Score",                     isJsonb: false, group: "Direct" },
    { key: "age_at_collection", label: "Age at Collection",         isJsonb: false, group: "Direct" },
    { key: "height",            label: "Height (in)",               isJsonb: false, group: "Direct" },
    { key: "weight",            label: "Weight (lbs)",              isJsonb: false, group: "Direct" },
  ],
  hitting: [
    { key: "age_at_collection", label: "Age at Collection",         isJsonb: false, group: "Direct" },
    { key: "height",            label: "Height (in)",               isJsonb: false, group: "Direct" },
    { key: "weight",            label: "Weight (lbs)",              isJsonb: false, group: "Direct" },
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
    { key: "rise_time_10_90_s",    label: "Rise Time 10–90% (s)",          isJsonb: false, group: "Direct" },
    { key: "fwhm_s",               label: "FWHM (s)",                       isJsonb: false, group: "Direct" },
    { key: "auc_j",                label: "Area Under Curve (J)",           isJsonb: false, group: "Direct" },
    { key: "work_early_pct",       label: "Work Early %",                   isJsonb: false, group: "Direct" },
    { key: "decay_90_10_s",        label: "Decay 90–10% (s)",              isJsonb: false, group: "Direct" },
    { key: "t_com_norm_0to1",      label: "COM Timing (0–1 normalized)",   isJsonb: false, group: "Direct" },
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
    { key: "rise_time_10_90_s", label: "Rise Time 10–90% (s)",       isJsonb: false, group: "Direct" },
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
    { key: "num_taps_10s", label: "Taps in First 10s",   isJsonb: false, group: "Direct" },
    { key: "num_taps_20s", label: "Taps in First 20s",   isJsonb: false, group: "Direct" },
    { key: "num_taps_30s", label: "Taps in First 30s",   isJsonb: false, group: "Direct" },
    { key: "num_taps",     label: "Total Taps",           isJsonb: false, group: "Direct" },
  ],
  athletic_screen_ppu: [
    { key: "jh_in",          label: "Jump Height (in)",            isJsonb: false, group: "Direct" },
    { key: "peak_power",     label: "Peak Power (normalized)",      isJsonb: false, group: "Direct" },
    { key: "pp_w_per_kg",    label: "Peak Power (W/kg)",           isJsonb: false, group: "Direct" },
    { key: "peak_power_w",   label: "Peak Power (W)",              isJsonb: false, group: "Direct" },
    { key: "time_to_peak_s", label: "Time to Peak (s)",            isJsonb: false, group: "Direct" },
    { key: "rpd_max_w_per_s",label: "Max Rate of Power Dev (W/s)", isJsonb: false, group: "Direct" },
    { key: "fwhm_s",         label: "FWHM (s)",                    isJsonb: false, group: "Direct" },
    { key: "auc_j",          label: "AUC (J)",                     isJsonb: false, group: "Direct" },
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
};

/**
 * GET /api/dashboard/research/variables?table=pitching
 * Returns all selectable variables for the given table.
 * JSONB keys are prefixed with "jsonb:" so the data route can distinguish them.
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
      // Sample up to 200 recent rows to collect all unique JSONB keys.
      // Scanning a small subset is both fast and sufficient — all trials share the same key schema.
      // LIMIT 3000 on the outer query is a safety cap; in practice there are ~200–500 unique keys.
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
        key:    `jsonb:${r.key}`,
        label:  r.key,
        isJsonb: true,
        group:  "Kinematics (JSON)",
      }));
    }

    return success({ variables: [...direct, ...jsonbVars] });
  } catch (err) {
    console.error("[research/variables] error:", err);
    return internalError("Failed to fetch variables");
  }
}
