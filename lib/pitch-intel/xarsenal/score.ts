/**
 * xArsenal grading for Pitch Intelligence (server-only).
 *
 * The scoring itself is Octane's, copied verbatim into octane-engine.ts:
 * benchmarks, the monotone-cubic metric curve, interaction bonuses, the
 * 106/107 caps, velocity offsets and weight multipliers, letter grades,
 * labels and the arsenal description.
 *
 * Around it, this file adds what Ryan's dashboard expects from his Worker's
 * scoreArsenal (8ctane API Worker reference doc), which Octane's API doesn't do:
 *   - Statcast pitch codes instead of a category (known codes stay in their family;
 *     SL / SV / CU / KC / CS best-fit across several subtypes)
 *   - missing metrics are dropped and the remaining weights renormalize
 *   - spin efficiency is estimated from velo, spin, movement and extension when not given
 *   - per-metric importance tier (primary / secondary / minor) and improvement direction
 *   - "levers": points gained if one metric were raised to "good" (80), top 3
 *   - free-text competition levels mapped to Octane's six
 *   - single and batch ({ items: [...] }) requests
 * Those pieces are reconstructed from that doc, not copied, so they can differ
 * slightly from Ryan's Worker; the grade math does not.
 */

import {
  BENCHMARKS,
  CLAMP_RANGES,
  INTERACTION_BONUSES,
  SUBTYPES_BY_CATEGORY,
  SUBTYPE_DISPLAY,
  VELOCITY_OFFSETS,
  VELOCITY_WEIGHT_MULTIPLIERS,
  arsenalDescription,
  clamp,
  gradeLabel,
  letterGrade,
  metricStatus,
  scoreMetric,
} from "./octane-engine";
import type { CompLevel, MetricStatus, MetricThresholds, PitchCategory, PitchResult, PitchSubtype } from "./types";

const METRICS = ["velocity", "spinRate", "ivb", "hb", "extension", "vaa", "spinEfficiency"] as const;
type Metric = (typeof METRICS)[number];
type Inputs = Record<Metric, number | null>;

// ---------------------------------------------------------------------------
// Request mapping
// ---------------------------------------------------------------------------

const CODE_MAP: Record<string, { category: PitchCategory; subtypes: PitchSubtype[] }> = {
  FF: { category: "Fastball", subtypes: ["4-Seam"] },
  FA: { category: "Fastball", subtypes: ["4-Seam"] },
  SI: { category: "Fastball", subtypes: ["Sinker"] },
  FT: { category: "Fastball", subtypes: ["Sinker"] },
  FC: { category: "Fastball", subtypes: ["Cutter"] },
  SL: { category: "Breaking Ball", subtypes: ["Slutter", "Slider", "Gyro Slider"] },
  ST: { category: "Breaking Ball", subtypes: ["Sweeper"] },
  SV: { category: "Breaking Ball", subtypes: ["Slider", "Sweeper", "Standard Curve"] },
  CU: { category: "Breaking Ball", subtypes: ["Standard Curve", "12-6 Curve", "Gyro Curve"] },
  KC: { category: "Breaking Ball", subtypes: ["Standard Curve", "12-6 Curve", "Gyro Curve"] },
  CS: { category: "Breaking Ball", subtypes: ["Standard Curve", "12-6 Curve", "Gyro Curve"] },
  CH: { category: "Off-Speed", subtypes: ["Change-Up"] },
  SC: { category: "Off-Speed", subtypes: ["Change-Up"] },
  FS: { category: "Off-Speed", subtypes: ["Splitter"] },
  FO: { category: "Off-Speed", subtypes: ["Splitter"] },
};

/** Free-text level (as stored on the athlete) -> Octane competition level. */
export function compLevelFor(level: string | null | undefined): CompLevel {
  const s = (level ?? "").trim();
  if (/^mlb$/i.test(s)) return "MLB";
  if (/\b(aaa|aa|a\+|high-a|low-a|rookie|milb|fcl|acl|dsl)\b/i.test(s) || /^a$/i.test(s) || /\bA\b/.test(s)) return "MiLB";
  if (/college|ncaa|naia|juco|\bd[123]\b/i.test(s)) return "College";
  if (/high school|\bhs\b/i.test(s)) return "High School";
  if (/youth|1[234]u/i.test(s)) return "Youth (14U)";
  return "Indy / Summer Ball";
}

// ---------------------------------------------------------------------------
// Spin efficiency estimate
// ---------------------------------------------------------------------------

/**
 * Estimated spin efficiency (%), from movement and spin (Nathan trajectory model,
 * Sawicki lift coefficient). Magnus acceleration from total induced movement
 * over the flight from release to the plate -> lift coefficient -> spin factor ->
 * transverse spin, divided by total spin. Directional only.
 */
export function estimateSpinEfficiency(velo: number | null, spin: number | null, ivb: number | null, hb: number | null, ext: number | null): number | null {
  if (velo == null || spin == null || ivb == null || hb == null || spin <= 0 || velo <= 0) return null;
  const R = 0.1208; // ball radius, ft
  const K = 0.005296; // 0.5 * air density * cross-section / mass, 1/ft (sea level, 70F)
  const v = velo * 1.4667 * 0.95; // average speed over the flight, ft/s
  const dist = 60.5 - (ext ?? 6.2) - 1.417; // release to front of plate, ft
  const t = dist / v;
  const moveFt = Math.hypot(ivb, hb) / 12;
  const accel = (2 * moveFt) / (t * t);
  const cl = accel / (K * v * v);
  const S = cl < 0.15 ? cl / 1.5 : (cl - 0.09) / 0.6;
  const transverseRpm = ((S * v) / R) * (60 / (2 * Math.PI));
  return Math.round(clamp((transverseRpm / spin) * 100, 0, 100));
}

// ---------------------------------------------------------------------------
// Scoring around Octane's engine
// ---------------------------------------------------------------------------

function veloMultiplierFor(category: PitchCategory, level: CompLevel, veloWeighted: boolean): number {
  if (category === "Breaking Ball" && !veloWeighted) return 0;
  return VELOCITY_WEIGHT_MULTIPLIERS[level];
}

function effectiveWeight(metric: Metric, t: MetricThresholds, veloMult: number): number {
  return metric === "velocity" ? t.weight * veloMult : t.weight;
}

/** Raw (unrounded) metric scores; null when the metric isn't used for this subtype or the value is missing. */
function metricScores(inputs: Inputs, subtype: PitchSubtype): Record<Metric, number | null> {
  const bm = BENCHMARKS[subtype];
  const out = {} as Record<Metric, number | null>;
  for (const m of METRICS) {
    const t = bm[m];
    const v = inputs[m];
    out[m] = t.weight === 0 || v == null ? null : scoreMetric(v, t);
  }
  return out;
}

/** Octane's scoreAgainstBenchmark, over the metrics present (weights renormalize). */
function combine(scores: Record<Metric, number | null>, subtype: PitchSubtype, veloMult: number): number {
  const bm = BENCHMARKS[subtype];
  let sum = 0;
  let total = 0;
  for (const m of METRICS) {
    const s = scores[m];
    if (s == null) continue;
    const w = effectiveWeight(m, bm[m], veloMult);
    if (w === 0) continue;
    sum += s * w;
    total += w;
  }
  if (total === 0) return 0;
  const bonus = INTERACTION_BONUSES[subtype];
  let interaction = 0;
  if (bonus) {
    const s1 = scores[bonus.metrics[0] as Metric];
    const s2 = scores[bonus.metrics[1] as Metric];
    if (s1 != null && s2 != null) interaction = (s1 / 100) * (s2 / 100) * bonus.maxBonus;
  }
  return Math.min(Math.round(sum / total + interaction), 106);
}

function importanceFor(w: number): "primary" | "secondary" | "minor" | null {
  if (w >= 0.2) return "primary";
  if (w >= 0.1) return "secondary";
  if (w > 0) return "minor";
  return null;
}

/** Plain-language direction to improve a metric for this subtype (HB is arm-side positive). */
function directionFor(metric: Metric, t: MetricThresholds): string {
  const up = t.higherIsBetter;
  switch (metric) {
    case "velocity":
      return up ? "more velo" : "less velo";
    case "spinRate":
      return up ? "more spin" : "less spin";
    case "ivb":
      return up ? "more ride (IVB)" : "more depth (less IVB)";
    case "hb":
      if (up) return "more arm-side run (HB)";
      return t.avg <= 0 ? "more glove-side break (HB)" : "less arm-side run (HB)";
    case "extension":
      return up ? "more extension" : "less extension";
    case "vaa":
      return up ? "a flatter approach angle (VAA)" : "a steeper approach angle (VAA)";
    case "spinEfficiency":
      return up ? "more spin efficiency" : "more gyro spin (lower efficiency)";
  }
}

export interface XaPitchRequest {
  key?: string;
  code?: string;
  category?: string;
  velocity?: number | null;
  spinRate?: number | null;
  ivb?: number | null;
  hb?: number | null;
  extension?: number | null;
  vaa?: number | null;
  spinEfficiency?: number | null;
}

export interface XaRequest {
  hand?: string;
  level?: string;
  veloWeighted?: boolean;
  pitches?: XaPitchRequest[];
}

interface XaMetric {
  score: number | null;
  status: MetricStatus | null;
  importance: "primary" | "secondary" | "minor" | null;
  direction: string;
}

export interface XaPitchResult {
  key: string;
  code: string;
  category: PitchCategory;
  subtype: PitchSubtype;
  displayType: string;
  score: number;
  grade: string;
  gradeLabel: string;
  metrics: Record<Metric, XaMetric>;
  levers: Array<{ metric: Metric; gain: number; direction: string }>;
  spinEfficiency: number | null;
  spinEffEstimated: boolean;
}

export interface XaResult {
  compLevel: CompLevel;
  arsenalScore: number;
  arsenalGrade: string;
  arsenalLabel: string;
  description: string;
  pitches: XaPitchResult[];
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const isCategory = (c: unknown): c is PitchCategory => c === "Fastball" || c === "Breaking Ball" || c === "Off-Speed";

function scoreOnePitch(p: XaPitchRequest, level: CompLevel, lefty: boolean, veloWeighted: boolean): XaPitchResult | null {
  const code = String(p.code ?? p.key ?? "").toUpperCase();
  const mapped = CODE_MAP[code] ?? (isCategory(p.category) ? { category: p.category, subtypes: SUBTYPES_BY_CATEGORY[p.category] } : null);
  if (!mapped) return null;

  const velocity = num(p.velocity);
  const spinRate = num(p.spinRate);
  const ivb = num(p.ivb);
  const hb = num(p.hb);
  const extension = num(p.extension);
  const vaa = num(p.vaa);
  let spinEfficiency = num(p.spinEfficiency);
  let spinEffEstimated = false;
  if (spinEfficiency == null) {
    spinEfficiency = estimateSpinEfficiency(velocity, spinRate, ivb, hb, extension);
    spinEffEstimated = spinEfficiency != null;
  }

  // Octane's input prep: clamp, velocity offset for the level, flip HB for lefties.
  const c = (m: Metric, v: number | null) => (v == null ? null : clamp(v, ...CLAMP_RANGES[m]));
  const inputs: Inputs = {
    velocity: velocity == null ? null : clamp((c("velocity", velocity) as number) + VELOCITY_OFFSETS[level], ...CLAMP_RANGES.velocity),
    spinRate: c("spinRate", spinRate),
    ivb: c("ivb", ivb),
    hb: hb == null ? null : (lefty ? -1 : 1) * (c("hb", hb) as number),
    extension: c("extension", extension),
    vaa: c("vaa", vaa),
    spinEfficiency: c("spinEfficiency", spinEfficiency),
  };

  const veloMult = veloMultiplierFor(mapped.category, level, veloWeighted);
  let best: { subtype: PitchSubtype; score: number; scores: Record<Metric, number | null> } | null = null;
  for (const subtype of mapped.subtypes) {
    const scores = metricScores(inputs, subtype);
    const score = combine(scores, subtype, veloMult);
    if (!best || score > best.score) best = { subtype, score, scores };
  }
  if (!best) return null;

  const bm = BENCHMARKS[best.subtype];
  const metrics = {} as Record<Metric, XaMetric>;
  const levers: XaPitchResult["levers"] = [];
  for (const m of METRICS) {
    const raw = best.scores[m];
    const rounded = raw == null ? null : Math.round(raw);
    const w = effectiveWeight(m, bm[m], veloMult);
    metrics[m] = {
      score: rounded,
      status: rounded == null ? null : metricStatus(rounded),
      importance: importanceFor(w),
      direction: directionFor(m, bm[m]),
    };
    if (raw != null && raw < 80 && w > 0) {
      const gain = combine({ ...best.scores, [m]: 80 }, best.subtype, veloMult) - best.score;
      if (gain > 0) levers.push({ metric: m, gain, direction: metrics[m].direction });
    }
  }
  levers.sort((a, b) => b.gain - a.gain);

  return {
    key: String(p.key ?? code),
    code,
    category: mapped.category,
    subtype: best.subtype,
    displayType: SUBTYPE_DISPLAY[best.subtype],
    score: best.score,
    grade: letterGrade(best.score),
    gradeLabel: gradeLabel(best.score),
    metrics,
    levers: levers.slice(0, 3),
    spinEfficiency,
    spinEffEstimated,
  };
}

export function scoreArsenalRequest(req: XaRequest): XaResult {
  const level = compLevelFor(req.level);
  const lefty = String(req.hand ?? "R").toUpperCase().startsWith("L");
  const veloWeighted = req.veloWeighted ?? true;
  const pitches = (req.pitches ?? [])
    .map((p) => scoreOnePitch(p, level, lefty, veloWeighted))
    .filter((p): p is XaPitchResult => p != null);
  const arsenalScore = pitches.length ? Math.round(pitches.reduce((s, p) => s + p.score, 0) / pitches.length) : 0;
  return {
    compLevel: level,
    arsenalScore,
    arsenalGrade: letterGrade(arsenalScore),
    arsenalLabel: gradeLabel(arsenalScore),
    // Octane's template only reads displayType and score.
    description: arsenalDescription(pitches as unknown as PitchResult[], arsenalScore),
    pitches,
  };
}

/** Single request, or batch { items: [{ id, hand, level, veloWeighted, pitches }] } -> { results: [{ id, ...grade }] }. */
export function scoreArsenalBody(body: Record<string, unknown>): XaResult | { results: Array<XaResult & { id: unknown }> } {
  if (Array.isArray(body.items)) {
    return {
      results: (body.items as Array<XaRequest & { id?: unknown }>).map((item) => ({ id: item.id, ...scoreArsenalRequest(item) })),
    };
  }
  return scoreArsenalRequest(body as XaRequest);
}
