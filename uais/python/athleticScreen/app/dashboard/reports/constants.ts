export const REPORT_TYPES = [
  { id: "athletic-screen", label: "Athletic Screen" },
  { id: "pro-sup", label: "Pro-Sup" },
  { id: "arm-action", label: "Arm Action" },
  { id: "curveball", label: "Curveball" },
] as const;

export type ReportTypeId = (typeof REPORT_TYPES)[number]["id"];

export type AthleteOption = { athlete_uuid: string; name: string };

/**
 * Report types that can produce a multi-session comparison PDF. Only the
 * athletic screen has a comparison pipeline today; the mode toggle stays
 * hidden for everything else rather than offering a button that fails.
 */
export const COMPARISON_CAPABLE: readonly ReportTypeId[] = ["athletic-screen"];

export type ReportMode = "single" | "comparison";

/** Mirrors MAX_SESSIONS in comparison_report/config.py — keep them in step. */
export const MAX_COMPARISON_SESSIONS = 4;
export const MIN_COMPARISON_SESSIONS = 2;

/** Movement order used by the report, so the UI chips read the same way. */
export const MOVEMENT_ORDER = ["DJ", "CMJ", "PPU", "SLV"] as const;

/**
 * Session swatch colors, matching SESSION_COLORS in comparison_report/config.py.
 * Chronological: index 0 is the oldest selected session. Showing the same
 * colors in the picker means the chips you clicked are the dots you see on
 * the report.
 */
export const SESSION_COLORS = ["#2c99d4", "#ff8c00", "#2ecc71", "#e91e63"] as const;
