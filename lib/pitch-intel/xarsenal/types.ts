/**
 * xArsenal types, copied from the Octane app (lib/schemas/xArsenal.ts) so the
 * generated octane-engine.ts compiles here unchanged. Types only: thresholds
 * live in octane-engine.ts (server-only).
 */

export const PITCH_CATEGORIES = ["Fastball", "Breaking Ball", "Off-Speed"] as const;
export type PitchCategory = (typeof PITCH_CATEGORIES)[number];

export const PITCH_SUBTYPES = [
  "4-Seam",
  "Sinker",
  "Cutter",
  "Slutter",
  "Slider",
  "Gyro Slider",
  "Sweeper",
  "Standard Curve",
  "12-6 Curve",
  "Gyro Curve",
  "Change-Up",
  "Splitter",
] as const;
export type PitchSubtype = (typeof PITCH_SUBTYPES)[number];

export type DisplayType = "4-Seam" | "Sinker" | "Cutter" | "Slider" | "Sweeper" | "Curveball" | "Changeup" | "Splitter";

export const COMP_LEVELS = ["Youth (14U)", "High School", "College", "Indy / Summer Ball", "MiLB", "MLB"] as const;
export type CompLevel = (typeof COMP_LEVELS)[number];

export type AthleteHand = "Left" | "Right";

export enum GradeLetter {
  A = "A",
  B = "B",
  C = "C",
  D = "D",
}

export interface MetricThresholds {
  floor: number;
  below: number;
  avg: number;
  good: number;
  elite: number;
  higherIsBetter: boolean;
  weight: number;
}

export interface PitchBenchmark {
  subtype: PitchSubtype;
  velocity: MetricThresholds;
  spinRate: MetricThresholds;
  ivb: MetricThresholds;
  hb: MetricThresholds;
  extension: MetricThresholds;
  vaa: MetricThresholds;
  spinEfficiency: MetricThresholds;
}

export interface PitchInput {
  category: PitchCategory;
  velocity: number;
  spinRate: number;
  ivb: number;
  hb: number;
  extension: number;
  vaa: number;
  spinEfficiency: number;
}

export type MetricStatus = "elite" | "above_avg" | "avg" | "below_avg" | "poor";

export interface MetricResult {
  score: number;
  status: MetricStatus;
}

export interface PitchResult {
  category: PitchCategory;
  subtype: PitchSubtype;
  displayType: DisplayType;
  score: number;
  grade: string;
  gradeLabel: string;
  metrics: Record<"velocity" | "spinRate" | "ivb" | "hb" | "extension" | "vaa" | "spinEfficiency", MetricResult>;
}
