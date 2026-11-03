/**
 * Pitch categories for pitching 3D captures (client-safe: no server imports).
 * Set by the R ingest from the QTM measurement type (f_pitching_trials.pitch_category).
 * Only fastballs are graded or leave the coach hub.
 */
export type PitchCategory = "fastball" | "breaking_ball" | "off_speed" | "pitch";

export const PITCH_CATEGORIES: PitchCategory[] = ["fastball", "breaking_ball", "off_speed", "pitch"];

export const PITCH_CATEGORY_LABEL: Record<PitchCategory, { one: string; many: string }> = {
  fastball: { one: "Fastball", many: "fastballs" },
  breaking_ball: { one: "Breaking Ball", many: "breaking balls" },
  off_speed: { one: "Off Speed", many: "off-speed pitches" },
  pitch: { one: "Pitch (untyped)", many: "untyped pitches" },
};

export function parsePitchCategory(v: string | null | undefined): PitchCategory | null {
  return v && (PITCH_CATEGORIES as string[]).includes(v) ? (v as PitchCategory) : null;
}

/** Short prefix for per-throw labels ("FB #3", "BB #1"). */
export const PITCH_CATEGORY_SHORT: Record<PitchCategory, string> = {
  fastball: "FB",
  breaking_ball: "BB",
  off_speed: "OS",
  pitch: "P",
};
