/**
 * Auto pitch tagging for untagged Trackman pitches, one session at a time.
 *
 * 1. Fastball reference: the hard pitches (within 5 mph of the session's top
 *    velo) that carry (IVB > 4"). Median velo / IVB / arm-side HB / spin.
 * 2. Each pitch goes to a family: fastball (within 4 mph of the fastball),
 *    off-speed (slower, arm-side), or breaking (slower, glove-side or down).
 * 3. Families are split into two shapes only when the split is clear
 *    (centroids 8"+ apart, 3+ pitches each), then each shape is named from its
 *    average: e.g. breaking with average IVB <= -5" -> curveball.
 *
 * HB is converted to arm-side positive first (Trackman HorzBreak is + toward
 * the pitcher's right, so arm-side for a righty). Results are a starting point
 * for the review step, not a final answer.
 */

import type { PitchCode } from "../pitch-types";

export interface ClassifyInput {
  velo: number | null;
  spin: number | null;
  ivb: number | null;
  hb: number | null; // Trackman sign
  throws: "L" | "R" | null;
}

interface Pt {
  i: number;
  velo: number;
  spin: number | null;
  ivb: number;
  hbA: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

/** Two-means on (IVB, arm-side HB); returns [group] or [a, b] when clearly bimodal. */
function split(points: Pt[]): Pt[][] {
  if (points.length < 6) return [points];
  // Seed with the two most different shapes (most "up and arm-side" vs most "down and glove-side").
  const a = points.reduce((p, q) => (q.ivb + q.hbA > p.ivb + p.hbA ? q : p));
  const b = points.reduce((p, q) => (q.ivb + q.hbA < p.ivb + p.hbA ? q : p));
  let ca = { ivb: a.ivb, hbA: a.hbA };
  let cb = { ivb: b.ivb, hbA: b.hbA };
  let ga: Pt[] = [];
  let gb: Pt[] = [];
  for (let iter = 0; iter < 20; iter++) {
    ga = [];
    gb = [];
    for (const p of points) {
      const da = Math.hypot(p.ivb - ca.ivb, p.hbA - ca.hbA);
      const db = Math.hypot(p.ivb - cb.ivb, p.hbA - cb.hbA);
      (da <= db ? ga : gb).push(p);
    }
    if (!ga.length || !gb.length) return [points];
    ca = { ivb: mean(ga.map((p) => p.ivb)), hbA: mean(ga.map((p) => p.hbA)) };
    cb = { ivb: mean(gb.map((p) => p.ivb)), hbA: mean(gb.map((p) => p.hbA)) };
  }
  const apart = Math.hypot(ca.ivb - cb.ivb, ca.hbA - cb.hbA);
  return apart >= 8 && ga.length >= 3 && gb.length >= 3 ? [ga, gb] : [points];
}

export function classifySession(pitches: ClassifyInput[]): Array<PitchCode | null> {
  const out: Array<PitchCode | null> = pitches.map(() => null);
  const pts: Pt[] = [];
  pitches.forEach((p, i) => {
    if (p.velo == null || p.ivb == null || p.hb == null) return;
    pts.push({ i, velo: p.velo, spin: p.spin, ivb: p.ivb, hbA: p.throws === "L" ? -p.hb : p.hb });
  });
  if (!pts.length) return out;

  const top = quantile(pts.map((p) => p.velo), 0.95);
  let pool = pts.filter((p) => p.velo >= top - 5 && p.ivb > 4);
  if (!pool.length) pool = pts.filter((p) => p.velo >= top - 5);
  const poolSpins = pool.map((p) => p.spin).filter((s): s is number => s != null);
  const fb = {
    velo: median(pool.map((p) => p.velo)),
    ivb: median(pool.map((p) => p.ivb)),
    hbA: median(pool.map((p) => p.hbA)),
    spin: poolSpins.length ? median(poolSpins) : null,
  };

  const families: Record<"fb" | "off" | "brk", Pt[]> = { fb: [], off: [], brk: [] };
  for (const p of pts) {
    const dv = fb.velo - p.velo;
    // A changeup can sit within 4 mph of the fastball; ~20%+ less spin gives it away.
    const lowSpin = p.spin != null && fb.spin != null && p.spin < 0.8 * fb.spin;
    if (dv <= 4 && !(lowSpin && dv >= 2 && p.hbA >= 6)) families.fb.push(p);
    else if (p.hbA >= 6 && p.ivb > -4) families.off.push(p);
    else families.brk.push(p);
  }

  const name = (family: keyof typeof families, g: Pt[], groups: Pt[][]): PitchCode => {
    const ivb = mean(g.map((p) => p.ivb));
    const hbA = mean(g.map((p) => p.hbA));
    const dv = fb.velo - mean(g.map((p) => p.velo));
    const spins = g.map((p) => p.spin).filter((s): s is number => s != null);
    const spin = spins.length ? mean(spins) : null;
    if (family === "fb") {
      if (groups.length === 2) {
        // Two fastball shapes: the one with less ride (relative to run) is the sinker or cutter.
        const other = groups[0] === g ? groups[1] : groups[0];
        const oIvb = mean(other.map((p) => p.ivb));
        const oHbA = mean(other.map((p) => p.hbA));
        if (ivb - hbA < oIvb - oHbA) return hbA >= oHbA ? "SI" : "FC";
        return "FF";
      }
      // One fastball shape: call it a 4-seam unless it is clearly a sinker or cutter.
      if (ivb < 7 && hbA >= 13) return "SI";
      if (hbA <= 3 && ivb < 10) return "FC";
      return "FF";
    }
    if (family === "off") return ivb <= 4 && spin != null && spin < 1500 ? "FS" : "CH";
    if (ivb <= -5 || (ivb <= -3 && dv >= 10)) return "CU";
    if (hbA <= -13) return "ST";
    if (dv <= 7 && ivb >= 2 && hbA > -6) return "FC";
    return "SL";
  };

  for (const family of ["fb", "off", "brk"] as const) {
    if (!families[family].length) continue;
    const groups = split(families[family]);
    for (const g of groups) {
      const code = name(family, g, groups);
      for (const p of g) out[p.i] = code;
    }
  }

  // No movement recorded: a pitch at fastball velo and spin is still a fastball; leave the rest untagged.
  pitches.forEach((p, i) => {
    if (out[i] != null || p.velo == null) return;
    const lowSpin = p.spin != null && fb.spin != null && p.spin < 0.8 * fb.spin;
    if (fb.velo - p.velo <= 3 && !lowSpin) out[i] = "FF";
  });
  return out;
}
