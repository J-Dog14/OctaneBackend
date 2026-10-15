/** Pure helpers for the coach pitch report: per-type summaries, strike zone, clock tilt. */

import { PITCH_CODES, type PitchCode } from "@/lib/pitch-intel/pitch-types";
import type { PitchResult, PitchRow } from "@/lib/coach/pitchLog";

/** Rulebook zone half-width (17 in plate + a ball radius), ft. */
export const ZONE_HALF_WIDTH = 0.83;
/** Default zone height for bullpens (no batter), ft. Savant pitches carry their own. */
export const ZONE_BOT = 1.5;
export const ZONE_TOP = 3.5;
/** "Edge" band just outside the zone, ft (~one ball width). */
export const EDGE = 0.25;

export type ZoneClass = "zone" | "edge" | "out";

export function zoneOf(p: Pick<PitchRow, "plateSide" | "plateHeight" | "zoneTop" | "zoneBot">): ZoneClass | null {
  if (p.plateSide == null || p.plateHeight == null) return null;
  const top = p.zoneTop ?? ZONE_TOP;
  const bot = p.zoneBot ?? ZONE_BOT;
  const x = Math.abs(p.plateSide);
  const y = p.plateHeight;
  if (x <= ZONE_HALF_WIDTH && y >= bot && y <= top) return "zone";
  if (x <= ZONE_HALF_WIDTH + EDGE && y >= bot - EDGE && y <= top + EDGE) return "edge";
  return "out";
}

/** "1:45" -> minutes on a 12 h clock (0..719), 12:00 = 0. */
export function tiltMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]) % 12;
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || min >= 60) return null;
  return h * 60 + min;
}

export function minutesToTilt(minutes: number): string {
  const total = ((Math.round(minutes / 15) * 15) % 720 + 720) % 720;
  const h = Math.floor(total / 60);
  return `${h === 0 ? 12 : h}:${String(total % 60).padStart(2, "0")}`;
}

/** Circular mean of clock tilts (so 11:45 and 12:15 average to 12:00, not 6:00). */
export function meanTilt(tilts: Array<string | null>): string | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const t of tilts) {
    const m = tiltMinutes(t);
    if (m == null) continue;
    const a = (m / 720) * 2 * Math.PI;
    sx += Math.cos(a);
    sy += Math.sin(a);
    n++;
  }
  if (!n || (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9)) return null;
  let a = Math.atan2(sy, sx);
  if (a < 0) a += 2 * Math.PI;
  return minutesToTilt((a / (2 * Math.PI)) * 720);
}

const avg = (xs: Array<number | null>) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const max = (xs: Array<number | null>) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? Math.max(...v) : null;
};
const pct = (a: number, b: number) => (b ? (a / b) * 100 : null);

export interface TypeSummary {
  type: PitchCode | "ALL";
  n: number;
  usage: number | null;
  velo: number | null;
  veloMax: number | null;
  spin: number | null;
  spinMax: number | null;
  extension: number | null;
  ivb: number | null;
  hbArm: number | null;
  tilt: string | null;
  measuredTilt: string | null;
  spinEff: number | null;
  gyro: number | null;
  relHeight: number | null;
  relSide: number | null;
  vaa: number | null;
  haa: number | null;
  zonePct: number | null;
  edgePct: number | null;
  outPct: number | null;
  located: number;
  /** Results (games only): per pitch with a result; whiff% per swing. */
  withResult: number;
  strikePct: number | null;
  cswPct: number | null;
  whiffPct: number | null;
  swings: number;
}

const SWING: PitchResult[] = ["whiff", "foul", "inplay"];

export function summarize(pitches: PitchRow[], type: PitchCode | "ALL", total: number): TypeSummary {
  const ps = type === "ALL" ? pitches : pitches.filter((p) => p.type === type);
  const zones = ps.map(zoneOf).filter((z): z is ZoneClass => z != null);
  const results = ps.map((p) => p.result).filter((r): r is PitchResult => r != null);
  const swings = results.filter((r) => SWING.includes(r)).length;
  const count = (k: ZoneClass) => zones.filter((z) => z === k).length;
  return {
    type,
    n: ps.length,
    usage: type === "ALL" ? null : pct(ps.length, total),
    velo: avg(ps.map((p) => p.velo)),
    veloMax: max(ps.map((p) => p.velo)),
    spin: avg(ps.map((p) => p.spin)),
    spinMax: max(ps.map((p) => p.spin)),
    extension: avg(ps.map((p) => p.extension)),
    ivb: avg(ps.map((p) => p.ivb)),
    hbArm: avg(ps.map((p) => p.hbArm)),
    tilt: type === "ALL" ? null : meanTilt(ps.map((p) => p.tilt)),
    measuredTilt: type === "ALL" ? null : meanTilt(ps.map((p) => p.measuredTilt)),
    spinEff: avg(ps.map((p) => p.spinEff)),
    gyro: avg(ps.map((p) => p.gyro)),
    relHeight: avg(ps.map((p) => p.relHeight)),
    relSide: avg(ps.map((p) => p.relSide)),
    vaa: avg(ps.map((p) => p.vaa)),
    haa: avg(ps.map((p) => p.haa)),
    zonePct: pct(count("zone"), zones.length),
    edgePct: pct(count("edge"), zones.length),
    outPct: pct(count("out"), zones.length),
    located: zones.length,
    withResult: results.length,
    strikePct: pct(results.filter((r) => r !== "ball" && r !== "hbp").length, results.length),
    cswPct: pct(results.filter((r) => r === "called" || r === "whiff").length, results.length),
    whiffPct: pct(results.filter((r) => r === "whiff").length, swings),
    swings,
  };
}

/** Pitch types present, in the app's standard order. */
export function typesIn(pitches: PitchRow[]): PitchCode[] {
  const seen = new Set(pitches.map((p) => p.type));
  return PITCH_CODES.filter((c) => seen.has(c));
}

/** "10/10/2026 11:39:18 AM" -> "11:39:18 AM"; other formats unchanged. */
export function timeOnly(t: string | null): string | null {
  if (!t) return null;
  const m = /^\d{1,2}\/\d{1,2}\/\d{4}\s+(.*)$/.exec(t.trim());
  return m ? m[1]! : t;
}
