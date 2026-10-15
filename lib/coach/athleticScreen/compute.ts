/**
 * Athletic screen report pages, ported from
 * uais/python/athleticScreen/pdf_report.py so the in-app report shows the same
 * numbers as the PDF: histograms with athlete mean/extreme lines, F–V scatter,
 * Force/Velocity @ peak power rings, 6-axis percentile radar (kurtosis scored
 * by distance from the per-movement ideal range), power curve with the 10–90%
 * rise, and the Max RPD / Kurtosis / Work table with population tiers.
 *
 * Keep the constants in step with pdf_report.py. Pure: no database access.
 */

export type Movement = "DJ" | "CMJ" | "PPU" | "SLV";
export const MOVEMENTS: Movement[] = ["DJ", "CMJ", "PPU", "SLV"];

export const MOVEMENT_TITLE: Record<Movement, string> = {
  DJ: "Drop Jump",
  CMJ: "Counter Movement Jump",
  PPU: "Plyo Pushup",
  SLV: "Single Leg Vertical",
};

export type MetricKey =
  | "JH_IN" | "PP_W_per_kg" | "PP_FORCEPLATE" | "Force_at_PP" | "Vel_at_PP" | "auc_j" | "kurtosis"
  | "rpd_max_w_per_s" | "time_to_rpd_max_s" | "CT" | "RSI";

export const METRIC_LABELS: Partial<Record<MetricKey, string>> = {
  JH_IN: "Jump Height",
  PP_W_per_kg: "Peak Power (Norm)",
  auc_j: "Work (AUC)",
  kurtosis: "Kurtosis",
  rpd_max_w_per_s: "Max RPD",
  time_to_rpd_max_s: "Time to Max RPD",
  RSI: "RSI",
  CT: "CT",
};

const RADAR_METRICS: MetricKey[] = ["JH_IN", "PP_W_per_kg", "auc_j", "kurtosis", "rpd_max_w_per_s", "time_to_rpd_max_s"];

export const KURTOSIS_IDEAL_RANGE: Record<Movement, [number, number]> = {
  DJ: [-1.45, -1.1],
  CMJ: [-1.3, -0.4],
  PPU: [-1.55, -1.25],
  SLV: [-1.0, -0.2],
};
const ELITE_RPD_REFERENCE: Record<Movement, number> = { DJ: 32700, CMJ: 25200, PPU: 8000, SLV: 18200 };
const ELITE_AUC_REFERENCE: Record<Movement, number> = { DJ: 570, CMJ: 1260, PPU: 700, SLV: 1030 };

export type Tier = "Low" | "Below Average" | "Average" | "High" | "Elite";
export type KurtosisLabel = "Very Flat" | "Moderately Flat" | "Typical" | "Sharp";

export type Row = Partial<Record<MetricKey, number | null>> & { trial?: string | null; side?: string | null };

// ---------------------------------------------------------------------------
// Math helpers (scipy / numpy equivalents)
// ---------------------------------------------------------------------------

const finite = (xs: Array<number | null | undefined>) => xs.filter((x): x is number => x != null && Number.isFinite(x));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** scipy.stats.percentileofscore(a, score, kind="rank"). */
export function percentileOfScore(values: number[], score: number | null | undefined): number | null {
  if (score == null || !Number.isFinite(score) || !values.length) return null;
  let left = 0;
  let right = 0;
  for (const v of values) {
    if (v < score) left++;
    if (v <= score) right++;
  }
  return ((left + right + (right > left ? 1 : 0)) * 50) / values.length;
}

export interface HistBin { x0: number; x1: number; count: number }

/** numpy.histogram with min(30, max(10, sqrt(n))) equal-width bins. */
export function histogram(values: number[]): HistBin[] {
  if (!values.length) return [];
  const n = Math.min(30, Math.max(10, Math.floor(Math.sqrt(values.length))));
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === hi) {
    lo -= 0.5;
    hi += 0.5;
  }
  const w = (hi - lo) / n;
  const bins: HistBin[] = Array.from({ length: n }, (_, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, count: 0 }));
  for (const v of values) bins[Math.min(n - 1, Math.floor((v - lo) / w))]!.count++;
  return bins;
}

/** Python format_sigfig from pdf_report.py. */
export function formatSigfig(value: number | null | undefined, sigfigs: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const order = Math.floor(Math.log10(Math.abs(value)));
  const decimals = sigfigs - 1 - order;
  const rounded = decimals >= 0 ? Number(value.toFixed(decimals)) : Math.round(value / 10 ** -decimals) * 10 ** -decimals;
  if (Math.abs(rounded) >= 1) {
    if (Number.isInteger(rounded)) return String(rounded);
    const places = Math.max(0, sigfigs - String(Math.trunc(Math.abs(rounded))).length);
    return rounded.toFixed(places).replace(/0+$/, "").replace(/\.$/, "");
  }
  return rounded.toFixed(Math.max(0, decimals)).replace(/0+$/, "").replace(/\.$/, "");
}

function percentileToTier(p: number): Tier {
  return p < 20 ? "Low" : p < 40 ? "Below Average" : p < 60 ? "Average" : p < 80 ? "High" : "Elite";
}
const STATIC_RPD: Array<[Tier, number]> = [["Low", 8400], ["Below Average", 12280], ["Average", 17846], ["High", 25000], ["Elite", Infinity]];
const STATIC_AUC: Array<[Tier, number]> = [["Low", 366], ["Below Average", 513], ["Average", 773], ["High", 1100], ["Elite", Infinity]];
function staticTier(v: number, t: Array<[Tier, number]>): Tier {
  return t.find(([, hi]) => v < hi)![0];
}
export function kurtosisLabel(v: number): KurtosisLabel {
  return v < -1.3 ? "Very Flat" : v < -0.4 ? "Moderately Flat" : v < 0.5 ? "Typical" : "Sharp";
}

function kurtosisDeviation(v: number, [lo, hi]: [number, number]): number {
  return v >= lo && v <= hi ? 0 : Math.min(Math.abs(v - lo), Math.abs(v - hi));
}

// ---------------------------------------------------------------------------
// Page model
// ---------------------------------------------------------------------------

export interface BarPanel {
  metric: MetricKey;
  label: string;
  bins: HistBin[];
  /** Single-athlete movements. */
  mean?: number | null;
  extreme?: number | null;
  extremeLabel?: "Max" | "Min";
  percentile?: number | null;
  /** SLV. */
  left?: { mean: number | null; percentile: number | null };
  right?: { mean: number | null; percentile: number | null };
  decimals: number;
}

export interface Ring { label: string; side?: "Left" | "Right"; metric: "force" | "velocity"; percentile: number; value: number | null; unit: string }

export interface RadarSeries { name: string; values: number[] }

export interface PowerCurves {
  /** Normalized time 0..1, 200 points. */
  t: number[];
  trials: number[][];
  mean: number[] | null;
  rise: { t10: number; p10: number; t90: number; p90: number } | null;
  /** SLV. */
  left?: { trials: number[][]; mean: number[] | null };
  right?: { trials: number[][]; mean: number[] | null };
}

export interface TableRow {
  variable: string;
  value: string;
  tier: string;
  tierColor: TierColor;
  ideal: string;
}
export type TierColor = Tier | "kurtIn" | "kurtOut" | "none";

export interface MovementPage {
  movement: Movement;
  title: string;
  trials: number;
  bars: BarPanel[];
  fv: {
    population: Array<[number, number]>;
    meanForce: number | null;
    meanVel: number | null;
    athlete: Array<{ label: string; force: number; vel: number; color: string }>;
    ppPercentile: number | null;
  };
  rings: Ring[];
  radar: { labels: string[]; series: RadarSeries[] };
  power: PowerCurves | null;
  table: TableRow[];
}

export interface PopulationData {
  rows: Row[];
  /** Pre-extracted columns (finite values only). */
  col: (k: MetricKey) => number[];
}

export function population(rows: Row[]): PopulationData {
  const cache = new Map<MetricKey, number[]>();
  return {
    rows,
    col: (k) => {
      let c = cache.get(k);
      if (!c) {
        c = finite(rows.map((r) => r[k]));
        cache.set(k, c);
      }
      return c;
    },
  };
}

function avgRow(rows: Row[]): Row {
  const out: Row = {};
  const keys = new Set<MetricKey>();
  for (const r of rows) for (const k of Object.keys(r)) if (k !== "trial" && k !== "side") keys.add(k as MetricKey);
  for (const k of keys) out[k] = mean(finite(rows.map((r) => r[k])));
  return out;
}

function radarValues(row: Row, pop: PopulationData, movement: Movement): number[] {
  const ideal = KURTOSIS_IDEAL_RANGE[movement];
  return RADAR_METRICS.map((k) => {
    const v = row[k];
    if (v == null) return 0;
    if (k === "kurtosis") {
      const devs = pop.col("kurtosis").map((x) => kurtosisDeviation(x, ideal));
      const p = percentileOfScore(devs, kurtosisDeviation(v, ideal));
      return p == null ? 0 : Math.max(0, Math.min(1, 1 - p / 100));
    }
    const p = percentileOfScore(pop.col(k), v);
    return p == null ? 0 : p / 100;
  });
}

function bar(metric: MetricKey, athlete: Row[], pop: PopulationData): BarPanel {
  const vals = finite(athlete.map((r) => r[metric]));
  const m = mean(vals);
  const isCt = metric === "CT";
  return {
    metric,
    label: METRIC_LABELS[metric] ?? metric,
    bins: histogram(pop.col(metric)),
    mean: m,
    extreme: vals.length ? (isCt ? Math.min(...vals) : Math.max(...vals)) : null,
    extremeLabel: isCt ? "Min" : "Max",
    percentile: m == null ? null : percentileOfScore(pop.col(metric), m),
    decimals: isCt ? 2 : 1,
  };
}

function slvBar(metric: MetricKey, left: Row[], right: Row[], pop: PopulationData): BarPanel {
  const side = (rows: Row[]) => {
    const m = mean(finite(rows.map((r) => r[metric])));
    return { mean: m, percentile: m != null && m > 0 ? percentileOfScore(pop.col(metric), m) : null };
  };
  return { metric, label: METRIC_LABELS[metric] ?? metric, bins: histogram(pop.col(metric)), left: side(left), right: side(right), decimals: 1 };
}

function ring(label: string, metric: "force" | "velocity", row: Row, pop: PopulationData, side?: "Left" | "Right"): Ring {
  const key: MetricKey = metric === "force" ? "Force_at_PP" : "Vel_at_PP";
  const p = percentileOfScore(pop.col(key), row[key]);
  return { label, side, metric, percentile: Math.max(0, Math.min(100, p ?? 0)), value: row[key] ?? null, unit: metric === "force" ? "N" : "m/s" };
}

function tierFor(value: number | null | undefined, popVals: number[], fallback: Array<[Tier, number]>): Tier | null {
  if (value == null) return null;
  const p = popVals.length ? percentileOfScore(popVals, value) : null;
  return p != null ? percentileToTier(p) : staticTier(value, fallback);
}

function tableRows(movement: Movement, pop: PopulationData, rows: Array<{ prefix: string; row: Row }>): TableRow[] {
  const [klo, khi] = KURTOSIS_IDEAL_RANGE[movement];
  const multi = rows.length > 1;
  const join = (f: (r: Row) => string) => rows.map(({ prefix, row }) => (multi ? `${prefix}: ${f(row)}` : f(row))).join("\n");
  const first = rows[0]?.row ?? {};
  const rpdTier = (r: Row) => tierFor(r.rpd_max_w_per_s, pop.col("rpd_max_w_per_s"), STATIC_RPD) ?? "N/A";
  const aucTier = (r: Row) => tierFor(r.auc_j, pop.col("auc_j"), STATIC_AUC) ?? "N/A";
  const k = first.kurtosis;
  return [
    {
      variable: "Max RPD (W/s)",
      value: join((r) => formatSigfig(r.rpd_max_w_per_s, 4)),
      tier: join(rpdTier),
      tierColor: (tierFor(first.rpd_max_w_per_s, pop.col("rpd_max_w_per_s"), STATIC_RPD) ?? "none") as TierColor,
      ideal: `>${formatSigfig(ELITE_RPD_REFERENCE[movement], 4)}`,
    },
    {
      variable: "Kurtosis",
      value: join((r) => formatSigfig(r.kurtosis, 3)),
      tier: join((r) => (r.kurtosis == null ? "N/A" : kurtosisLabel(r.kurtosis))),
      tierColor: k == null ? "none" : k >= klo && k <= khi ? "kurtIn" : "kurtOut",
      ideal: `${formatSigfig(klo, 3)} to ${formatSigfig(khi, 3)}`,
    },
    {
      variable: "Work (AUC)",
      value: join((r) => formatSigfig(r.auc_j, 4)),
      tier: join(aucTier),
      tierColor: (tierFor(first.auc_j, pop.col("auc_j"), STATIC_AUC) ?? "none") as TierColor,
      ideal: `>${formatSigfig(ELITE_AUC_REFERENCE[movement], 4)}`,
    },
  ];
}

const T200 = Array.from({ length: 200 }, (_, i) => i / 199);

/** Resample one trial onto 200 normalized-time points (scipy interp1d, linear). */
function resample(power: number[]): number[] {
  const n = power.length;
  if (n === 0) return [];
  if (n === 1) return T200.map(() => power[0]!);
  return T200.map((t) => {
    const x = t * (n - 1);
    const i = Math.min(n - 2, Math.floor(x));
    const f = x - i;
    return power[i]! * (1 - f) + power[i + 1]! * f;
  });
}

function meanCurve(curves: number[][]): number[] | null {
  if (!curves.length) return null;
  return T200.map((_, i) => curves.reduce((a, c) => a + c[i]!, 0) / curves.length);
}

function rise(m: number[] | null): PowerCurves["rise"] {
  if (!m) return null;
  const max = Math.max(...m);
  const i10 = m.findIndex((p) => p >= 0.1 * max);
  const i90 = m.findIndex((p) => p >= 0.9 * max);
  if (i10 < 0 || i90 < 0) return null;
  return { t10: T200[i10]!, p10: m[i10]!, t90: T200[i90]!, p90: m[i90]! };
}

const FV_MAX_POINTS = 900;

function fvPopulation(pop: PopulationData): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (const r of pop.rows) {
    if (r.Force_at_PP != null && r.Vel_at_PP != null && Number.isFinite(r.Force_at_PP) && Number.isFinite(r.Vel_at_PP)) pairs.push([r.Force_at_PP, r.Vel_at_PP]);
  }
  if (pairs.length <= FV_MAX_POINTS) return pairs;
  const step = pairs.length / FV_MAX_POINTS;
  return Array.from({ length: FV_MAX_POINTS }, (_, i) => pairs[Math.floor(i * step)]!);
}

/**
 * One report page. `curves` maps trial name → raw power (W) series, when the
 * warehouse has them (f_athletic_screen_power_curve).
 */
export function buildMovementPage(movement: Movement, athlete: Row[], pop: PopulationData, curves: Map<string, number[]>): MovementPage | null {
  if (!athlete.length || !pop.rows.length) return null;
  const meanForce = mean(pop.col("Force_at_PP"));
  const meanVel = mean(pop.col("Vel_at_PP"));

  if (movement === "SLV") {
    const left = athlete.filter((r) => r.side === "Left");
    const right = athlete.filter((r) => r.side === "Right");
    const L = left.length ? avgRow(left) : null;
    const R = right.length ? avgRow(right) : null;
    const curveFor = (rows: Row[]) => rows.map((r) => (r.trial ? curves.get(r.trial) : undefined)).filter((c): c is number[] => !!c?.length).map(resample);
    const lc = curveFor(left);
    const rc = curveFor(right);
    const athletePts: MovementPage["fv"]["athlete"] = [];
    if (L?.Force_at_PP != null && L.Vel_at_PP != null) athletePts.push({ label: "Left Mean", force: L.Force_at_PP, vel: L.Vel_at_PP, color: "#1a5f8a" });
    if (R?.Force_at_PP != null && R.Vel_at_PP != null) athletePts.push({ label: "Right Mean", force: R.Force_at_PP, vel: R.Vel_at_PP, color: "#ff0000" });
    const series: RadarSeries[] = [];
    if (L) series.push({ name: "Left Leg", values: radarValues(L, pop, movement) });
    if (R) series.push({ name: "Right Leg", values: radarValues(R, pop, movement) });
    return {
      movement,
      title: MOVEMENT_TITLE[movement],
      trials: athlete.length,
      bars: (["JH_IN", "PP_W_per_kg"] as MetricKey[]).map((k) => slvBar(k, left, right, pop)),
      fv: { population: fvPopulation(pop), meanForce, meanVel, athlete: athletePts, ppPercentile: null },
      rings: [
        ...(L ? [ring("Force", "force", L, pop, "Left"), ring("Velocity", "velocity", L, pop, "Left")] : []),
        ...(R ? [ring("Force", "force", R, pop, "Right"), ring("Velocity", "velocity", R, pop, "Right")] : []),
      ],
      radar: { labels: RADAR_METRICS.map((k) => METRIC_LABELS[k]!), series },
      power: lc.length || rc.length
        ? { t: T200, trials: [], mean: null, rise: null, left: { trials: lc, mean: meanCurve(lc) }, right: { trials: rc, mean: meanCurve(rc) } }
        : null,
      table: tableRows(movement, pop, [
        ...(L ? [{ prefix: "L", row: L }] : []),
        ...(R ? [{ prefix: "R", row: R }] : []),
      ]),
    };
  }

  const best = avgRow(athlete);
  const barMetrics: MetricKey[] = movement === "DJ" ? ["JH_IN", "PP_W_per_kg", "RSI", "CT"] : ["JH_IN", "PP_W_per_kg"];
  const trialCurves = athlete.map((r) => (r.trial ? curves.get(r.trial) : undefined)).filter((c): c is number[] => !!c?.length).map(resample);
  const m = meanCurve(trialCurves);
  return {
    movement,
    title: MOVEMENT_TITLE[movement],
    trials: athlete.length,
    bars: barMetrics.map((k) => bar(k, athlete, pop)),
    fv: {
      population: fvPopulation(pop),
      meanForce,
      meanVel,
      athlete: best.Force_at_PP != null && best.Vel_at_PP != null ? [{ label: "Current Athlete", force: best.Force_at_PP, vel: best.Vel_at_PP, color: "#ff0000" }] : [],
      ppPercentile: percentileOfScore(pop.col("PP_FORCEPLATE"), best.PP_FORCEPLATE),
    },
    rings: [ring("Force", "force", best, pop), ring("Velocity", "velocity", best, pop)],
    radar: { labels: RADAR_METRICS.map((k) => METRIC_LABELS[k]!), series: [{ name: "Athlete", values: radarValues(best, pop, movement) }] },
    power: trialCurves.length ? { t: T200, trials: trialCurves, mean: m, rise: rise(m) } : null,
    table: tableRows(movement, pop, [{ prefix: "", row: best }]),
  };
}
