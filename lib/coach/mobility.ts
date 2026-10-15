/**
 * Mobility history for the coach suite: every session, every component's raw
 * value and percentile, and a per-category percentile over time.
 *
 * Decisions (Joey, 2026-10-14):
 * - A component's percentile ranks the value against every athlete's latest
 *   known value for that component (pandas rank(pct=True), ties averaged, the
 *   athlete included), like the pro-sup report. Lower-is-better metrics (elbow
 *   extension, Hawkins-Kennedy) are ranked inverted.
 * - A category's percentile for a session is the mean of the percentiles of the
 *   components measured that session. Re-check sheets only fill in a few
 *   metrics, so a category gets a point only on dates it has data, and each
 *   component chart only has points on dates that component was measured.
 * - Several sheets on the same date are merged (newest sheet wins per metric).
 */

import { definePopulation } from "@/lib/percentiles/populations";
import { prisma } from "@/lib/db/prisma";
import { NON_SCORING_COLUMNS, SCALE_3_COLUMNS, isRomDegreeColumn } from "@/lib/octane/mobilityColumnTypes";
import { FALLBACK_RANGES, MOBILITY_GROUPS, getOrientation, scoreComponent, toNumber } from "@/lib/octane/mobilityPayload";
import { rankPct } from "@/lib/coach/proSup";

export type MobilityUnit = "deg" | "grade" | "posneg" | "force" | "lbs" | "number";
export type MobilitySide = "R" | "L" | "Dom" | "NonDom";

export interface MobilityPoint {
  date: string;
  value: number;
  percentile: number | null;
  /** 0-100 score against the optimal range (drives the pill colour), null when unscored. */
  rangeScore: number | null;
}

export interface MobilityComponent {
  key: string;
  label: string;
  unit: MobilityUnit;
  orientation: "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";
  optimalRange: string | null;
  /** Athletes with a value for this component (percentile population). */
  populationN: number;
  /** Oldest first; only dates where the component was measured. */
  points: MobilityPoint[];
}

/** One line chart under "Show details": an R/L (or dominant/non-dominant) pair, or a single component. */
export interface MobilityChart {
  id: string;
  title: string;
  unit: MobilityUnit;
  series: Array<{ key: string; label: string; side: MobilitySide | null }>;
}

export interface MobilityGroupHistory {
  name: string;
  components: MobilityComponent[];
  charts: MobilityChart[];
  /** Category percentile per session (oldest first), only dates with data in this category. */
  points: Array<{ date: string; percentile: number; measured: number }>;
}

export interface MobilityHistory {
  athlete: { athleteUuid: string; name: string };
  /** Oldest first. */
  sessions: Array<{ date: string; measured: number; sheets: number; partial: boolean }>;
  groups: MobilityGroupHistory[];
  populationN: number;
}

/** R/L and dominant/non-dominant pairs drawn on one chart (R / dominant red, L / non-dominant blue). */
const PAIRS: Array<{ title: string; a: string; b: string; sides: [MobilitySide, MobilitySide] }> = [
  { title: "Rotation", a: "cervical_rotation_r_rom", b: "cervical_rotation_l_rom", sides: ["R", "L"] },
  { title: "Lateral Flexion", a: "cervical_lateral_flexion_r_rom", b: "cervical_lateral_flexion_l_rom", sides: ["R", "L"] },
  { title: "Shoulder IR", a: "dominant_shoulder_ir", b: "non_dominant_shoulder_ir", sides: ["Dom", "NonDom"] },
  { title: "Shoulder ER", a: "dominant_shoulder_er", b: "non_dominant_shoulder_er", sides: ["Dom", "NonDom"] },
  { title: "T-Spine PVC", a: "sittiing_t_spine_pvc_r", b: "sittiing_t_spine_pvc_l", sides: ["R", "L"] },
  { title: "Thomas Test", a: "thomas_test_hip_flexor_r", b: "thomas_test_hip_flexor_l", sides: ["R", "L"] },
  { title: "Hamstring Stretch", a: "r_hamstring_stretch_rom", b: "l_hamstring_stretch_rom", sides: ["R", "L"] },
  { title: "Hip Abduction ROM", a: "r_hip_abduction_rom", b: "l_hip_abduction_rom", sides: ["R", "L"] },
  { title: "Hip Flexion", a: "r_hip_flexion_rom", b: "l_hip_flexion_rom", sides: ["R", "L"] },
  { title: "Prone Hip IR", a: "r_prone_hip_ir", b: "l_prone_hip_ir", sides: ["R", "L"] },
  { title: "Prone Hip ER", a: "r_prone_hip_er", b: "l_prone_hip_er", sides: ["R", "L"] },
  { title: "Seated Hip IR", a: "seated_r_hip_ir_mmt", b: "seated_l_hip_ir_mmt", sides: ["R", "L"] },
  { title: "Seated Hip ER", a: "seated_r_hip_er_mmt", b: "seated_l_hip_er_mmt", sides: ["R", "L"] },
  { title: "Hamstring Raise", a: "r_prone_hamstring_raise_mmt", b: "l_prone_hamstring_raise_mmt", sides: ["R", "L"] },
  { title: "Glute Raise", a: "r_prone_glute_raise_mmt", b: "l_prone_glute_raise_mmt", sides: ["R", "L"] },
  { title: "Hip Abduction MMT", a: "r_hip_abduction_mmt", b: "l_hip_abduction_mmt", sides: ["R", "L"] },
  { title: "Hip Adduction MMT", a: "r_hip_adduction_mmt", b: "l_hip_adduction_mmt", sides: ["R", "L"] },
  { title: "Dorsiflexion to Wall", a: "r_ankle_dorsiflexion_to_wall_rom", b: "l_ankle_dorsiflexion_to_wall_rom", sides: ["R", "L"] },
  { title: "Dorsiflexion MMT", a: "r_ankle_dorsiflexion_mmt", b: "l_ankle_dorsiflexion_mmt", sides: ["R", "L"] },
  { title: "Inversion", a: "r_ankle_inversion_mmt", b: "l_ankle_inversion_mmt", sides: ["R", "L"] },
  { title: "Eversion", a: "r_ankle_eversion_mmt", b: "l_ankle_eversion_mmt", sides: ["R", "L"] },
  { title: "Grip Strength", a: "grip_strength_r", b: "gs_l", sides: ["R", "L"] },
  { title: "Grip Strength at 90°", a: "grip_strength_r_at_90", b: "gs_l_at_90", sides: ["R", "L"] },
];

const SIDE_LABEL: Record<MobilitySide, string> = { R: "R", L: "L", Dom: "Dominant", NonDom: "Non-dominant" };

export function unitFor(key: string): MobilityUnit {
  if (SCALE_3_COLUMNS.has(key)) return "grade";
  if (key === "hawkins_kennedy_test") return "posneg";
  if (key.endsWith("_mmt")) return "force";
  if (key.startsWith("grip_strength") || key.startsWith("gs_")) return "lbs";
  if (isRomDegreeColumn(key)) return "deg";
  return "number";
}

const ALL_KEYS = MOBILITY_GROUPS.flatMap((g) => g.columns.map((c) => c.key));

type RawRow = { athlete_uuid: string; d: string; created: string; j: Record<string, unknown> };

async function loadRows(where: { athleteUuid?: string }): Promise<RawRow[]> {
  // to_jsonb keeps this independent of which dynamic metric columns exist; numerics arrive as JS numbers.
  const sql = `SELECT athlete_uuid, session_date::text AS d, created_at::text AS created,
                      to_jsonb(m) - 'raw_values' - 'medical_history' AS j
               FROM public.f_mobility m
               ${where.athleteUuid ? "WHERE athlete_uuid = $1" : ""}
               ORDER BY session_date ASC, created_at ASC, id ASC`;
  return where.athleteUuid
    ? prisma.$queryRawUnsafe<RawRow[]>(sql, where.athleteUuid)
    : prisma.$queryRawUnsafe<RawRow[]>(sql);
}

/** Population: every athlete's latest non-blank value per component. */
const getPopulation = definePopulation(
  "coach-mobility-population-v1",
  async (): Promise<{ byKey: Record<string, number[]>; athletes: number }> => {
    const rows = await loadRows({});
    const latest = new Map<string, Record<string, number>>(); // athlete -> key -> value (rows are oldest first)
    for (const r of rows) {
      const cur = latest.get(r.athlete_uuid) ?? {};
      for (const k of ALL_KEYS) {
        const v = toNumber(r.j[k]);
        if (v != null) cur[k] = v;
      }
      latest.set(r.athlete_uuid, cur);
    }
    const byKey: Record<string, number[]> = {};
    for (const vals of latest.values()) {
      for (const [k, v] of Object.entries(vals)) (byKey[k] ??= []).push(v);
    }
    return { byKey, athletes: latest.size };
  },
  () => ({ byKey: {} as Record<string, number[]>, athletes: 0 }),
);

function percentileFor(key: string, value: number, pop: number[] | undefined): number | null {
  if (!pop?.length) return null;
  return getOrientation(key) === "LOWER_IS_BETTER"
    ? rankPct(pop.map((v) => -v), -value)
    : rankPct(pop, value);
}

export async function buildMobilityHistory(athleteUuid: string): Promise<MobilityHistory | null> {
  const [athlete, rows, population] = await Promise.all([
    prisma.d_athletes.findUnique({ where: { athlete_uuid: athleteUuid }, select: { name: true } }),
    loadRows({ athleteUuid }),
    getPopulation(),
  ]);
  if (!rows.length) return null;

  // Merge rows that share a date; later sheets win per metric. Blank cells never overwrite.
  const byDate = new Map<string, { values: Record<string, number>; ranges: Record<string, string>; sheets: number }>();
  for (const r of rows) {
    const s = byDate.get(r.d) ?? { values: {}, ranges: {}, sheets: 0 };
    s.sheets += 1;
    for (const k of ALL_KEYS) {
      const v = toNumber(r.j[k]);
      if (v != null) s.values[k] = v;
    }
    const or = r.j.optimal_ranges;
    if (or && typeof or === "object") Object.assign(s.ranges, or as Record<string, string>);
    byDate.set(r.d, s);
  }
  const dates = [...byDate.keys()].sort();
  const sessionsWithData = dates.filter((d) => Object.keys(byDate.get(d)!.values).length > 0);
  const latestRanges: Record<string, string> = {};
  for (const d of sessionsWithData) Object.assign(latestRanges, byDate.get(d)!.ranges);

  const groups: MobilityGroupHistory[] = MOBILITY_GROUPS.map((g) => {
    const components: MobilityComponent[] = g.columns.map(({ key, label }) => {
      const pop = population.byKey[key];
      const points: MobilityPoint[] = [];
      for (const d of sessionsWithData) {
        const s = byDate.get(d)!;
        const v = s.values[key];
        if (v == null) continue;
        points.push({ date: d, value: v, percentile: percentileFor(key, v, pop), rangeScore: scoreComponent(key, v, s.ranges) });
      }
      return {
        key,
        label,
        unit: unitFor(key),
        orientation: getOrientation(key),
        optimalRange: latestRanges[key] ?? FALLBACK_RANGES[key] ?? null,
        populationN: pop?.length ?? 0,
        points,
      };
    });

    const groupPoints: MobilityGroupHistory["points"] = [];
    for (const d of sessionsWithData) {
      const pcts = components
        .filter((c) => !NON_SCORING_COLUMNS.has(c.key))
        .map((c) => c.points.find((p) => p.date === d)?.percentile)
        .filter((p): p is number => p != null);
      if (pcts.length) groupPoints.push({ date: d, percentile: pcts.reduce((a, b) => a + b, 0) / pcts.length, measured: pcts.length });
    }

    const inGroup = new Set(g.columns.map((c) => c.key));
    const used = new Set<string>();
    const charts: MobilityChart[] = [];
    for (const { key, label } of g.columns) {
      if (used.has(key)) continue;
      const pair = PAIRS.find((p) => (p.a === key || p.b === key) && inGroup.has(p.a) && inGroup.has(p.b));
      if (pair) {
        used.add(pair.a).add(pair.b);
        charts.push({
          id: pair.a,
          title: pair.title,
          unit: unitFor(pair.a),
          series: [
            { key: pair.a, label: SIDE_LABEL[pair.sides[0]], side: pair.sides[0] },
            { key: pair.b, label: SIDE_LABEL[pair.sides[1]], side: pair.sides[1] },
          ],
        });
      } else {
        used.add(key);
        charts.push({ id: key, title: label, unit: unitFor(key), series: [{ key, label, side: null }] });
      }
    }
    return { name: g.groupName, components, charts, points: groupPoints };
  });

  const maxMeasured = Math.max(...sessionsWithData.map((d) => Object.keys(byDate.get(d)!.values).length), 0);
  return {
    athlete: { athleteUuid, name: athlete?.name ?? "" },
    sessions: sessionsWithData.map((d) => {
      const s = byDate.get(d)!;
      const measured = Object.keys(s.values).length;
      // "Partial" = a re-check: well under the metrics of this athlete's fullest session.
      return { date: d, measured, sheets: s.sheets, partial: measured < maxMeasured * 0.6 };
    }),
    groups,
    populationN: population.athletes,
  };
}
