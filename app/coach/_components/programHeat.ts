/**
 * Muscle "freshness" for the Program tab body map: each set worked on a muscle
 * adds load that halves every HALF_LIFE_DAYS, so a muscle is darkest right after
 * it's trained and fades back to white over about a week. A set counts by its
 * weight relative to the athlete's heaviest for that exercise (unweighted = 1),
 * so a deload at 75% of the weight shades ~25% lighter.
 */
import type { WorkoutEntry } from "@/lib/coach/program";
import { countedSets, setLoad, type WeightRefs } from "./liftVolume";
import { MUSCLE_IDS, type MuscleId } from "@/lib/coach/programMuscles";

export const HALF_LIFE_DAYS = 3.5;
/** Load (effective sets at full weight) drawn at full colour. */
export const FULL_LOAD = 12;
/** Sets older than this no longer count. */
export const LOOKBACK_DAYS = 28;
const SECONDARY_WEIGHT = 0.5;

export type HeatMode = "completed" | "prescribed";

export interface MuscleHeat {
  load: number;
  /** 0-1, load / FULL_LOAD capped. */
  level: number;
  lastDate: string | null;
  /** Effective sets per exercise name in the window, biggest first. */
  exercises: Array<{ name: string; sets: number }>;
}

const DAY = 86_400_000;
export const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY;
export const dayStr = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

/** Sets that count for an entry in a mode (completed: logged sets only; prescribed: scheduled). */
export function setsFor(e: WorkoutEntry, mode: HeatMode): number {
  return mode === "prescribed" ? e.sets : (e.completed ?? 0);
}

export function muscleHeat(entries: WorkoutEntry[], asOf: string, mode: HeatMode, refs?: WeightRefs): Record<MuscleId, MuscleHeat> {
  const t = dayNum(asOf);
  const out = Object.fromEntries(MUSCLE_IDS.map((m) => [m, { load: 0, level: 0, lastDate: null, exercises: [] }])) as unknown as Record<MuscleId, MuscleHeat>;
  const perEx = new Map<MuscleId, Map<string, number>>();
  for (const e of entries) {
    const age = t - dayNum(e.date);
    if (age < 0 || age > LOOKBACK_DAYS) continue;
    // Load-weighted sets: each counted set × (its weight / the exercise's top weight).
    const sets = countedSets(e, mode).reduce((a, i) => a + setLoad(e, i, refs), 0);
    if (sets <= 0) continue;
    const decay = Math.pow(0.5, age / HALF_LIFE_DAYS);
    const add = (m: MuscleId, w: number) => {
      const h = out[m];
      h.load += sets * w * decay;
      if (!h.lastDate || e.date > h.lastDate) h.lastDate = e.date;
      const ex = perEx.get(m) ?? perEx.set(m, new Map()).get(m)!;
      ex.set(e.name, (ex.get(e.name) ?? 0) + sets * w);
    };
    for (const m of e.primary) add(m, 1);
    for (const m of e.secondary) if (!e.primary.includes(m)) add(m, SECONDARY_WEIGHT);
  }
  for (const m of MUSCLE_IDS) {
    const h = out[m];
    h.level = Math.min(1, h.load / FULL_LOAD);
    h.exercises = [...(perEx.get(m) ?? new Map()).entries()].map(([name, sets]) => ({ name, sets })).sort((a, b) => b.sets - a.sets);
  }
  return out;
}

// White (fresh) → deep red (just trained). Lightness falls monotonically.
const RAMP: Array<[number, [number, number, number]]> = [
  [0, [232, 236, 241]],
  [0.2, [249, 210, 196]],
  [0.45, [246, 152, 120]],
  [0.7, [236, 92, 64]],
  [1, [190, 36, 28]],
];

export function heatColor(level: number): string {
  const x = Math.max(0, Math.min(1, level));
  for (let i = 1; i < RAMP.length; i++) {
    const [x1, c1] = RAMP[i]!;
    const [x0, c0] = RAMP[i - 1]!;
    if (x <= x1) {
      const f = (x - x0) / (x1 - x0);
      const c = c0.map((v, k) => Math.round(v + (c1[k]! - v) * f));
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
  }
  return "rgb(190, 36, 28)";
}

export const RAMP_CSS = `linear-gradient(90deg, ${RAMP.map(([x, c]) => `rgb(${c.join(",")}) ${x * 100}%`).join(", ")})`;
