/**
 * Arm + flight geometry (pure, client-safe).
 *
 * Coordinate frames
 * - Lab (Qualisys, mm): +Y toward home plate, +Z up, +X = pitcher's right.
 *   (Checked on captures: the hand travels +Y through release; right-side markers sit at +X for a RHP.)
 * - Field (ft), right-handed: origin at the front of home plate on the ground,
 *   +Y toward the mound, +Z up, +X = the hitter's/catcher's right (= pitcher's LEFT).
 *   Lab → field is a 180° turn about Z plus a translation:  field = (-x, -y, z) / 304.8 + offset.
 * - TrackMan reports release side, plate side and HB from the pitcher's view (+ = pitcher's right),
 *   so their field X is the negative.
 *
 * The lab→field offset is fitted per session from the paired pitches: 3D hand position at
 * release vs TrackMan's release point (rel_side, 60.5 - extension, rel_height). Its residuals
 * double as a check on the pairing.
 */

export type V3 = [number, number, number];

export const MM_PER_FT = 304.8;
export const RUBBER_FT = 60.5;
/** Front edge of home plate, ft from the plate's back tip (where TrackMan plate location is measured). */
export const PLATE_FRONT_FT = 17 / 12;
const G_FT_S2 = 32.174;
const MPH_TO_FT_S = 5280 / 3600;

/** Points drawn for the throwing arm, in this order. */
export const ARM_POINTS = ["shoulder", "elbow", "medialElbow", "wristRadius", "wristUlna", "hand"] as const;
export type ArmPointId = (typeof ARM_POINTS)[number];

export function markerNames(side: "left" | "right"): Record<ArmPointId, string> {
  return {
    shoulder: `${side}_shoulder`,
    elbow: `${side}_elbow`,
    medialElbow: `${side}_medial_elbow`,
    wristRadius: `${side}_wrist_radius`,
    wristUlna: `${side}_wrist_ulna`,
    hand: `${side}_hand`,
  };
}

export const mid = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Lab mm → field ft, before the session offset is added. */
export const labToFieldRot = (p: V3): V3 => [-p[0] / MM_PER_FT, -p[1] / MM_PER_FT, p[2] / MM_PER_FT];

/** Linear gap-fill of missing samples (null) per series; leading/trailing gaps copy the nearest value. */
export function fillGaps(series: Array<V3 | null>): Array<V3 | null> {
  const out = [...series];
  const known = out.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  if (!known.length) return out;
  for (let i = 0; i < out.length; i++) {
    if (out[i]) continue;
    const prev = [...known].reverse().find((k) => k < i);
    const next = known.find((k) => k > i);
    if (prev == null) out[i] = out[next!];
    else if (next == null) out[i] = out[prev];
    else {
      const a = out[prev]!;
      const b = out[next]!;
      const w = (i - prev) / (next - prev);
      out[i] = [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
    }
  }
  return out;
}

/**
 * Ball release ≈ the frame of peak hand-marker speed (3-frame smoothed).
 * On sample captures this lands within 1 frame of Visual3D's Release event + 3 frames (10 ms).
 */
export function detectRelease(hand: Array<V3 | null>, frameRate: number): { frame: number; peakMph: number } | null {
  const speeds: Array<number | null> = hand.map((p, i) => {
    const q = hand[i - 1];
    return p && q && i > 0 ? (dist(p, q) * frameRate) / 1000 / 0.44704 : null;
  });
  let best: { frame: number; peakMph: number } | null = null;
  for (let i = 2; i < speeds.length - 1; i++) {
    const w = [speeds[i - 1], speeds[i], speeds[i + 1]];
    if (w.some((s) => s == null)) continue;
    const s = (w[0]! + w[1]! + w[2]!) / 3;
    if (!best || s > best.peakMph) best = { frame: i, peakMph: s };
  }
  return best;
}

export interface TrackmanRelease {
  pitchUid: string;
  relSide: number | null;
  relHeight: number | null;
  extension: number | null;
}

/** TrackMan release point in field ft, or null when TrackMan didn't read it. */
export function tmReleaseField(t: TrackmanRelease): V3 | null {
  if (t.relSide == null || t.relHeight == null || t.extension == null) return null;
  return [-t.relSide, RUBBER_FT - t.extension, t.relHeight];
}

export interface Registration {
  /** Added to labToFieldRot(p) to land in field ft. */
  offset: V3;
  /** Pairs used. */
  n: number;
  /** RMS distance (ft) between the moved 3D release points and TrackMan's. */
  rmsFt: number;
  /** Per pitch distance (ft) after the fit. */
  residualFt: Record<string, number>;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Translation-only fit (median per axis, robust to one bad pair). Needs ≥ 2 pairs. */
export function fitRegistration(pairs: Array<{ pitchUid: string; handLabMm: V3; tm: V3 }>): Registration | null {
  if (pairs.length < 2) return null;
  const diffs = pairs.map((p) => sub(p.tm, labToFieldRot(p.handLabMm)));
  const offset: V3 = [median(diffs.map((d) => d[0])), median(diffs.map((d) => d[1])), median(diffs.map((d) => d[2]))];
  const residualFt: Record<string, number> = {};
  let ss = 0;
  for (const p of pairs) {
    const r = dist(add(labToFieldRot(p.handLabMm), offset), p.tm);
    residualFt[p.pitchUid] = r;
    ss += r * r;
  }
  return { offset, n: pairs.length, rmsFt: Math.sqrt(ss / pairs.length), residualFt };
}

export interface FlightInputs {
  veloMph: number | null;
  relSide: number | null;
  relHeight: number | null;
  extension: number | null;
  plateSide: number | null;
  plateHeight: number | null;
  ivbIn: number | null;
  hbIn: number | null;
}

/** Ball path in field ft: [ms after release, x, y, z][]. */
export type FlightPath = Array<[number, number, number, number]>;

/**
 * Constant-acceleration flight from release to the front of the plate.
 * - Time: speed along Y drops ~8% by the plate (typical drag), so the average Y speed is 0.96·velo.
 * - X and Z: pass through the release point and the plate location, with the
 *   spin-induced accelerations implied by HB and IVB over the flight (gravity added to Z).
 * Returns null unless TrackMan read release, plate location and break.
 */
export function flightPath(f: FlightInputs, samples = 48): { path: FlightPath; flightMs: number } | null {
  if (f.veloMph == null || f.relSide == null || f.relHeight == null || f.extension == null) return null;
  if (f.plateSide == null || f.plateHeight == null || f.ivbIn == null || f.hbIn == null) return null;
  const y0 = RUBBER_FT - f.extension;
  const dy = y0 - PLATE_FRONT_FT;
  if (dy <= 30) return null;
  const v0 = f.veloMph * MPH_TO_FT_S;
  const vp = 0.92 * v0;
  const T = (2 * dy) / (v0 + vp);
  const ay = (v0 * v0 - vp * vp) / (2 * dy); // deceleration along -Y
  const x0 = -f.relSide;
  const xp = -f.plateSide;
  const z0 = f.relHeight;
  const zp = f.plateHeight;
  const ax = (-2 * (f.hbIn / 12)) / (T * T); // HB is pitcher's view (+ = pitcher's right = field -X)
  const az = -G_FT_S2 + (2 * (f.ivbIn / 12)) / (T * T);
  const vx0 = (xp - x0 - 0.5 * ax * T * T) / T;
  const vz0 = (zp - z0 - 0.5 * az * T * T) / T;
  const path: FlightPath = [];
  for (let i = 0; i <= samples; i++) {
    const t = (T * i) / samples;
    path.push([t * 1000, x0 + vx0 * t + 0.5 * ax * t * t, y0 - v0 * t + 0.5 * ay * t * t, z0 + vz0 * t + 0.5 * az * t * t]);
  }
  return { path, flightMs: T * 1000 };
}

/** Position on a flight path at `ms` after release (clamped to the path). */
export function flightAt(path: FlightPath, ms: number): V3 {
  if (ms <= path[0]![0]) return [path[0]![1], path[0]![2], path[0]![3]];
  for (let i = 1; i < path.length; i++) {
    const b = path[i]!;
    if (ms <= b[0]) {
      const a = path[i - 1]!;
      const w = (ms - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w, a[3] + (b[3] - a[3]) * w];
    }
  }
  const z = path[path.length - 1]!;
  return [z[1], z[2], z[3]];
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/**
 * Orbit camera for the arm view (orthographic). `az` = direction the camera looks, measured in
 * the ground plane from +Y (toward the mound): 0 = from home plate (hitter's view), 180 = from
 * behind the pitcher toward the plate (pitcher's view), 90 = from the third-base side.
 * `el` = how far the camera is above the horizon, looking down (90 = straight down).
 */
export interface Orbit {
  az: number;
  el: number;
}

export const VIEW_PRESETS = {
  pitcher: { az: 180, el: 3 },
  hitter: { az: 0, el: 14 },
  side: { az: 90, el: 10 },
  top: { az: 180, el: 89 },
} satisfies Record<string, Orbit>;
export type ViewPreset = keyof typeof VIEW_PRESETS;

export type Basis = { r: V3; u: V3 };

export function orbitBasis(o: Orbit): Basis {
  const el = (Math.max(-80, Math.min(89.5, o.el)) * Math.PI) / 180;
  const az = (o.az * Math.PI) / 180;
  const f: V3 = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), -Math.sin(el)];
  const r = norm(cross(f, [0, 0, 1]));
  const u = cross(r, f);
  return { r, u };
}

/** Orthographic projection of a field point: [right, up] on screen. */
export function orbitProject(p: V3, b: Basis): [number, number] {
  return [dot(p, b.r), dot(p, b.u)];
}

export interface Camera {
  eye: V3;
  target: V3;
  /** Screen units per unit of (lateral / depth). */
  focal: number;
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Pinhole projection: [right, up] on screen, or null behind the camera. */
export function perspectiveProject(p: V3, cam: Camera): [number, number] | null {
  const f = norm(sub(cam.target, cam.eye));
  const r = norm(cross(f, [0, 0, 1]));
  const u = cross(r, f);
  const d = sub(p, cam.eye);
  const depth = dot(d, f);
  if (depth <= 0.1) return null;
  return [(cam.focal * dot(d, r)) / depth, (cam.focal * dot(d, u)) / depth];
}

/**
 * Batter's eye (RHB stands on the field's -X side = catcher's left, LHB on +X), or "C" for a
 * catcher-height view from behind the plate.
 */
export function hitterCamera(batter: "R" | "L" | "C", target: V3): Camera {
  if (batter === "C") return { eye: [0, -6, 4.2], target, focal: 1 };
  return { eye: [batter === "R" ? -2.3 : 2.3, 0.7, 5.2], target, focal: 1 };
}
