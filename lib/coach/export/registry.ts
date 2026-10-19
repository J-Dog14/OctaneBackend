/**
 * What the coach data export can download, by category (one column on the
 * download page each). Every part is one table (or a fixed join) keyed by
 * athlete and date; table and column names here are the only SQL identifiers
 * the export uses, never anything from the request.
 */

export type ExportCategoryId = "trackman" | "savant" | "biomechanics" | "athleticScreen" | "mobility" | "proteus" | "other";

export interface ExportPart {
  id: string;
  /** Table whose existence is checked (schema-qualified). */
  table: string;
  /** FROM clause; defaults to `table`. */
  from?: string;
  select?: string;
  athleteExpr?: string;
  dateExpr: string;
  orderBy: string;
  /** Path inside the zip, under the category folder. */
  file: string;
  /** Listing: parts sharing a group show as one entry ("Pitching 3D"); null = not named. */
  group: string | null;
  /** Listing: count wording for this part ("12 trials"); null = no count. */
  unit?: "pitches" | "trials" | "tests" | null;
  /** Listing: extra SQL text shown for the date (e.g. "game", "vs GAS"). */
  listExtra?: string;
  flatten?: string[];
  drop?: string[];
  /** Per-trial time series stored as JSON: exported as one .json per row, only when raw data is requested. */
  raw?: boolean;
}

export interface ExportCategory {
  id: ExportCategoryId;
  label: string;
  folder: string;
  parts: ExportPart[];
}

const BASE_DROP = ["id", "athlete_uuid"];

function simple(
  id: string,
  table: string,
  file: string,
  group: string | null,
  extra: Partial<ExportPart> = {},
): ExportPart {
  return { id, table, dateExpr: "session_date", orderBy: "session_date, id", file, group, drop: BASE_DROP, ...extra };
}

function rawPart(id: string, table: string, group: string): ExportPart {
  return simple(id, table, `raw/${id}`, group, { raw: true, orderBy: "session_date, trial_index" });
}

export const EXPORT_CATEGORIES: ExportCategory[] = [
  {
    id: "trackman",
    label: "Pitching · TrackMan",
    folder: "pitching_trackman",
    parts: [
      {
        id: "trackman_pitches",
        table: "pitch_intel.trackman_pitches",
        dateExpr: "session_date",
        orderBy: "session_date, pitch_no NULLS LAST, pitch_time, pitch_uid",
        file: "trackman_pitches.csv",
        group: null,
        unit: "pitches",
        listExtra: "string_agg(DISTINCT session_type, ' / ')",
        flatten: ["raw"],
        drop: ["athlete_uuid", "link_id", "upload_id", "first_seen_at", "updated_at"],
      },
      {
        id: "summary_reports",
        table: "pitch_intel.aggregate_reports",
        from: "pitch_intel.aggregate_reports r JOIN pitch_intel.aggregate_pitch_rows p ON p.report_id = r.id",
        select: "r.report_date, r.source, r.season, r.level, r.throws, r.title, r.notes, p.*",
        athleteExpr: "r.athlete_uuid",
        dateExpr: "r.report_date",
        orderBy: "r.report_date, r.id, p.id",
        file: "summary_reports.csv",
        group: "Summary report",
        flatten: ["extra"],
        drop: ["id", "report_id"],
      },
    ],
  },
  {
    id: "savant",
    label: "Pitching · Savant",
    folder: "pitching_savant",
    parts: [
      {
        id: "savant_pitches",
        table: "pitch_intel.savant_pitches",
        dateExpr: "game_date",
        orderBy: "game_date, game_pk, at_bat_number, pitch_number",
        file: "savant_pitches.csv",
        group: null,
        unit: "pitches",
        // Pitching in the top of an inning = home team.
        listExtra: "string_agg(DISTINCT CASE WHEN inning_topbot = 'Top' THEN 'vs ' || away_team ELSE '@ ' || home_team END, ', ')",
        flatten: ["raw_extra"],
        drop: ["athlete_uuid", "link_id", "pull_run_id", "first_seen_at", "updated_at"],
      },
    ],
  },
  {
    id: "biomechanics",
    label: "Biomechanics",
    folder: "biomechanics",
    parts: [
      simple("pitching_trials", "public.f_pitching_trials", "pitching_trials.csv", "Pitching 3D", {
        unit: "trials", flatten: ["metrics"], orderBy: "session_date, trial_index",
      }),
      simple("pitching_force_metrics", "public.f_pitching_force_metrics", "pitching_force_metrics.csv", "Pitching 3D"),
      simple("pitching_time_data", "public.f_pitching_time_data", "pitching_time_data.csv", "Pitching 3D", { orderBy: "session_date, trial_index" }),
      simple("pitching_kinematics", "public.f_kinematics_pitching", "pitching_kinematics.csv", "Pitching 3D", { orderBy: "session_date, metric_name, frame" }),
      simple("arm_action", "public.f_arm_action", "arm_action.csv", "Arm action"),
      simple("hitting_trials", "public.f_hitting_trials", "hitting_trials.csv", "Hitting 3D", { unit: "trials", flatten: ["metrics"] }),
      simple("hitting_3d_trials", "public.f_hitting_3d_trials", "hitting_3d_trials.csv", "Hitting 3D"),
      simple("hitting_kinematics", "public.f_kinematics_hitting", "hitting_kinematics.csv", "Hitting 3D", { orderBy: "session_date, metric_name, frame" }),
      rawPart("pitching_force_data", "public.f_pitching_force_data", "Pitching 3D"),
      rawPart("pitching_marker_data", "public.f_pitching_marker_data", "Pitching 3D"),
      rawPart("pitching_segment_pos_data", "public.f_pitching_segment_pos_data", "Pitching 3D"),
      rawPart("pitching_segment_rot_data", "public.f_pitching_segment_rot_data", "Pitching 3D"),
      rawPart("hitting_force_data", "public.f_hitting_force_data", "Hitting 3D"),
      rawPart("hitting_marker_data", "public.f_hitting_marker_data", "Hitting 3D"),
      rawPart("hitting_segment_pos_data", "public.f_hitting_segment_pos_data", "Hitting 3D"),
      rawPart("hitting_segment_rot_data", "public.f_hitting_segment_rot_data", "Hitting 3D"),
    ],
  },
  {
    id: "athleticScreen",
    label: "Athletic screen",
    folder: "athletic_screen",
    parts: [
      simple("cmj", "public.f_athletic_screen_cmj", "cmj.csv", "CMJ"),
      simple("dj", "public.f_athletic_screen_dj", "dj.csv", "DJ"),
      simple("ppu", "public.f_athletic_screen_ppu", "ppu.csv", "PPU"),
      simple("slv", "public.f_athletic_screen_slv", "slv.csv", "SLV"),
      simple("nmt", "public.f_athletic_screen_nmt", "nmt.csv", "NMT"),
      simple("screen", "public.f_athletic_screen", "screen_sessions.csv", null),
    ],
  },
  {
    id: "mobility",
    label: "Mobility",
    folder: "mobility",
    parts: [simple("mobility", "public.f_mobility", "mobility.csv", null)],
  },
  {
    id: "proteus",
    label: "Proteus",
    folder: "proteus",
    parts: [simple("proteus", "public.f_proteus", "proteus.csv", null)],
  },
  {
    id: "other",
    label: "Other assessments",
    folder: "other",
    parts: [
      simple("readiness", "public.f_readiness_screen", "readiness/readiness_screen.csv", "Readiness"),
      simple("readiness_score", "public.f_readiness_screen_score", "readiness/score.csv", "Readiness"),
      simple("readiness_cmj", "public.f_readiness_screen_cmj", "readiness/cmj.csv", "Readiness"),
      simple("readiness_ppu", "public.f_readiness_screen_ppu", "readiness/ppu.csv", "Readiness"),
      simple("readiness_i", "public.f_readiness_screen_i", "readiness/i.csv", "Readiness"),
      simple("readiness_y", "public.f_readiness_screen_y", "readiness/y.csv", "Readiness"),
      simple("readiness_t", "public.f_readiness_screen_t", "readiness/t.csv", "Readiness"),
      simple("readiness_ir90", "public.f_readiness_screen_ir90", "readiness/ir90.csv", "Readiness"),
      simple("readiness_power_curve", "public.f_readiness_screen_power_curve", "readiness/power_curve.csv", "Readiness"),
      simple("readiness_grip", "public.f_readiness_screen_grip", "readiness/grip.csv", "Readiness"),
      simple("pro_sup", "public.f_pro_sup", "pro_sup.csv", "Pro-sup"),
      simple("curveball_test", "public.f_curveball_test", "curveball_test.csv", "Curveball test", { unit: "pitches" }),
    ],
  },
];

export const CATEGORY_IDS = EXPORT_CATEGORIES.map((c) => c.id);

export function isCategoryId(v: unknown): v is ExportCategoryId {
  return typeof v === "string" && (CATEGORY_IDS as string[]).includes(v);
}
