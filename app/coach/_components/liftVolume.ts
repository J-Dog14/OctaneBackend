/**
 * Lift volume for the Program Lift week chart and body map. Every set counts
 * its reps scaled by load: the set's weight relative to the heaviest weight the
 * athlete has for that exercise in the selected program(s). Unweighted work
 * counts at full value, so a deload week of the same program at 75% of the
 * weight shows as ~75% of the volume. Volume is split between upper and lower
 * body by each exercise's primary muscles.
 */

import type { WorkoutEntry } from "@/lib/coach/program";
import type { MuscleId } from "@/lib/coach/programMuscles";

export const UPPER: ReadonlySet<MuscleId> = new Set<MuscleId>([
  "neck", "traps", "lower_traps", "front_delts", "rear_delts", "rotator_cuff", "chest", "serratus",
  "biceps", "triceps", "forearms", "lats", "upper_back",
]);
export const LOWER: ReadonlySet<MuscleId> = new Set<MuscleId>([
  "glutes", "abductors", "adductors", "hip_flexors", "quads", "hamstrings", "calves",
]);
// Core (abs, obliques, lower back) counts toward neither line.

/** Blocks that make up "the lift" for the chart. */
export const LIFT_BLOCKS: ReadonlySet<WorkoutEntry["category"]> = new Set(["lift", "superset"]);

/** Reps one set contributes: reps (×2 per side); timed holds, breaths and yards count as 1 per set. */
export function setReps(unit: string | null, reps: number): number {
  if (!unit || unit === "REPS") return reps;
  if (unit === "PER_SIDE") return reps * 2;
  return 1;
}

/** Share of an exercise that is upper vs lower body (by primary muscles; secondary if no primary). */
export function regionShare(e: Pick<WorkoutEntry, "primary" | "secondary">): { upper: number; lower: number } {
  const ms = (e.primary.length ? e.primary : e.secondary) as MuscleId[];
  const up = ms.filter((m) => UPPER.has(m)).length;
  const lo = ms.filter((m) => LOWER.has(m)).length;
  const tot = up + lo;
  return tot ? { upper: up / tot, lower: lo / tot } : { upper: 0, lower: 0 };
}

export interface Volume { upper: number; lower: number; total: number }

/** Heaviest weight per exercise (logged or prescribed) — the 100% reference for load. */
export type WeightRefs = Map<string, number>;
const exKey = (e: Pick<WorkoutEntry, "exerciseId" | "name">) => (e.exerciseId != null ? `id:${e.exerciseId}` : `n:${e.name.toLowerCase()}`);

export function weightRefs(entries: WorkoutEntry[]): WeightRefs {
  const refs: WeightRefs = new Map();
  for (const e of entries) {
    const top = Math.max(0, ...e.weight, ...(e.rxWeight ?? []));
    if (top > 0 && top > (refs.get(exKey(e)) ?? 0)) refs.set(exKey(e), top);
  }
  return refs;
}

/** Weight of set i relative to the exercise's heaviest (1 when unweighted or no weight entered for the set). */
export function setLoad(e: WorkoutEntry, i: number, refs?: WeightRefs): number {
  const ref = refs?.get(exKey(e));
  if (!ref) return 1;
  const w = (e.weight[i] ?? 0) > 0 ? e.weight[i]! : (e.rxWeight?.[i] ?? 0);
  return w > 0 ? w / ref : 1;
}

/** Sets that count: all of them (prescribed) or those marked done (completed). */
export function countedSets(e: WorkoutEntry, which: "prescribed" | "completed"): number[] {
  const n = Math.max(e.reps.length, e.sets);
  const idx = Array.from({ length: n }, (_, i) => i);
  if (which === "prescribed") return idx;
  if (e.setMarks?.length) return idx.filter((i) => e.setMarks[i] === "done");
  return idx.slice(0, e.completed ?? 0);
}

/** Load-adjusted reps of an entry: Σ reps × (set weight / exercise's top weight). */
export function entryReps(e: WorkoutEntry, which: "prescribed" | "completed", refs?: WeightRefs): number {
  let n = 0;
  for (const i of countedSets(e, which)) n += setReps(e.repUnit, e.reps[i] ?? e.reps[e.reps.length - 1] ?? 0) * setLoad(e, i, refs);
  return n;
}

/** Average load across an entry's sets (1 = at the athlete's top weight for it). */
export function entryLoad(e: WorkoutEntry, refs?: WeightRefs): number {
  const n = Math.max(e.reps.length, e.sets);
  if (!n) return 1;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += setLoad(e, i, refs);
  return sum / n;
}

export function dayVolume(es: WorkoutEntry[], which: "prescribed" | "completed", refs?: WeightRefs): Volume {
  const v: Volume = { upper: 0, lower: 0, total: 0 };
  for (const e of es) {
    if (!LIFT_BLOCKS.has(e.category)) continue;
    const reps = entryReps(e, which, refs);
    const s = regionShare(e);
    v.upper += reps * s.upper;
    v.lower += reps * s.lower;
    v.total += reps;
  }
  v.upper = Math.round(v.upper);
  v.lower = Math.round(v.lower);
  v.total = Math.round(v.total);
  return v;
}
