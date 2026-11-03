/** App pitch codes (Statcast style), shared by uploads, the sessions view and xArsenal. */
export const PITCH_CODES = ["FF", "SI", "FC", "SL", "ST", "CU", "KC", "CH", "FS", "OTHER"] as const;
export type PitchCode = (typeof PITCH_CODES)[number];

export const PITCH_LABELS: Record<PitchCode, string> = {
  FF: "4-Seam",
  SI: "Sinker",
  FC: "Cutter",
  SL: "Slider",
  ST: "Sweeper",
  CU: "Curveball",
  KC: "K-Curve",
  CH: "Changeup",
  FS: "Splitter",
  OTHER: "Other",
};

/**
 * TrackMan's pitch-type colors (sampled from the TrackMan portal legend, 2026-11-03), so pitches read
 * the same in the coach suite as in TrackMan. TrackMan's knuckleball purple (#834FD4) has no code here.
 */
export const PITCH_COLORS: Record<PitchCode, string> = {
  FF: "#861B1B", // fastball (4-seam): red
  SI: "#E78C4C", // sinker: orange
  FC: "#44300A", // cutter: brown
  SL: "#D8B83D", // slider: yellow
  ST: "#AF8F2E", // sweeper: gold
  CU: "#5895F5", // curveball: light blue
  KC: "#5895F5", // knuckle curve: TrackMan's curveball blue
  CH: "#79A12F", // changeup: green
  FS: "#34778A", // splitter: teal
  OTHER: "#555566",
};

export function isPitchCode(v: unknown): v is PitchCode {
  return typeof v === "string" && (PITCH_CODES as readonly string[]).includes(v);
}

const TRACKMAN_TO_CODE: Record<string, PitchCode> = {
  fastball: "FF",
  "four-seam": "FF",
  "four seam": "FF",
  fourseamfastball: "FF",
  "4-seam": "FF",
  sinker: "SI",
  twoseamfastball: "SI",
  "two-seam": "SI",
  "two seam": "SI",
  cutter: "FC",
  slider: "SL",
  sweeper: "ST",
  curveball: "CU",
  curve: "CU",
  "knuckle curve": "KC",
  knucklecurve: "KC",
  splitter: "FS",
  "split-finger": "FS",
  splitfinger: "FS",
  changeup: "CH",
  "change-up": "CH",
  "change up": "CH",
};

/** Trackman's TaggedPitchType / AutoPitchType text -> app code; null when untagged ("Undefined", "Other", blank). */
export function codeFromTrackman(name: string | null | undefined): PitchCode | null {
  const key = (name ?? "").trim().toLowerCase();
  return TRACKMAN_TO_CODE[key] ?? null;
}

/** App code -> the Trackman name Ryan's parseTrackmanBulk understands. */
export const CODE_TO_TRACKMAN: Record<PitchCode, string> = {
  FF: "Fastball",
  SI: "Sinker",
  FC: "Cutter",
  SL: "Slider",
  ST: "Sweeper",
  CU: "Curveball",
  KC: "Curveball",
  CH: "Changeup",
  FS: "Splitter",
  OTHER: "Other",
};
