/**
 * xArsenal presentation rules, ported verbatim from Ryan's frontend (athletes-v2.js @ 0a683d0,
 * handoff `reference/xa-frontend.js`). The Worker's own gradeLabel / arsenalLabel / description
 * and metric `status` bands are on the pre-rescale cut (65 = "Plus-Plus"), so every app replaces
 * them with these. Pure functions, no server deps: safe to import from client components.
 *
 * Scale: 20-80, 50 = MLB average, 10 points = 1 SD. Grade = score rounded to the nearest 5,
 * clamped to 20-80; the label comes from the grade so the number and the word always agree.
 */

export const XA_LABELS: Array<[number, string]> = [
  [80, "Elite"],
  [70, "Plus-Plus"],
  [60, "Plus"],
  [55, "Above Avg"],
  [50, "Average"],
  [45, "Fringe"],
  [40, "Below Avg"],
  [-Infinity, "Poor"],
];

/** Score → grade (nearest 5, clamped 20-80). JS Math.round, so .5 rounds up (same as Ryan's). */
export function xaGrade(score: number | null | undefined): number | null {
  if (score == null || !Number.isFinite(score)) return null;
  return Math.max(20, Math.min(80, Math.round(score / 5) * 5));
}

export function xaLabel(score: number | null | undefined): string {
  const g = xaGrade(score);
  if (g == null) return "";
  return XA_LABELS.find(([t]) => g >= t)![1];
}

/** Lower-case form for sentences. */
export function xaLabelText(label: string | null | undefined): string {
  if (label === "Above Avg") return "above average";
  if (label === "Below Avg") return "below average";
  return String(label ?? "").toLowerCase();
}

/** Metric-bar band, from the metric's own score on the pitch-grade cut (Ryan's xaStatusCls, fixed Nov 4). */
export type XaBand = "elite" | "above" | "avg" | "below" | "poor";
export function xaBand(score: number | null | undefined): XaBand {
  const g = xaGrade(score) ?? 0;
  return g >= 70 ? "elite" : g >= 55 ? "above" : g >= 50 ? "avg" : g >= 40 ? "below" : "poor";
}
export const XA_BAND_COLOR: Record<XaBand, string> = {
  elite: "#22c55e",
  above: "#84cc16",
  avg: "#9ca3af",
  below: "#f59e0b",
  poor: "#f04040",
};

/** Metric-bar width (% of the 20-80 range); 50 sits at 50%. */
export const xaBarPct = (score: number) => Math.max(0, Math.min(100, ((score - 20) / 60) * 100));

export const XA_METRIC_LABEL: Record<string, string> = {
  velocity: "Velo",
  spinRate: "Spin",
  ivb: "IVB",
  hb: "HB",
  extension: "Ext",
  vaa: "VAA",
  spinEfficiency: "Spin eff",
  veloDiff: "Velo gap",
  ivbDiff: "IVB gap",
  hbDiff: "Run gap",
  spinDiff: "Spin gap",
  pairVelo: "FB velo match",
  pairIvb: "FB ride sep.",
  pairRun: "FB run sep.",
  pairCut: "Sep. vs cutter",
};
/** Ryan's XA_ORDER: display order within an importance tier. */
export const XA_METRIC_ORDER = [
  "velocity", "veloDiff", "spinRate", "spinDiff", "ivb", "ivbDiff", "hb", "hbDiff", "extension", "vaa", "spinEfficiency",
  "pairVelo", "pairIvb", "pairRun", "pairCut",
];
export const XA_IMPORTANCE_RANK: Record<string, number> = { primary: 0, secondary: 1, minor: 2 };

export const XA_PITCH_NAMES: Record<string, string> = {
  FF: "4-Seam", FA: "4-Seam", SI: "Sinker", FC: "Cutter", SL: "Slider", ST: "Sweeper", CU: "Curveball",
  KC: "K-Curve", FS: "Splitter", CH: "Changeup", CS: "Slow Curve", OTHER: "Other",
};
/** Pitch name for a Worker key: "FF" → "4-Seam"; Add Pitches keys "CH_new1" → "new Changeup". */
export function xaPitchName(key: string): string {
  const m = /^([A-Z]+)_new\d+$/.exec(key);
  if (m) return `new ${XA_PITCH_NAMES[m[1]!] ?? m[1]}`;
  return XA_PITCH_NAMES[key] ?? key;
}

/** Ryan's xaDescribe: best (and worst, if 5+ points lower) pitch, then the arsenal grade. */
export function xaDescribe(
  pitches: Array<{ key: string; score: number | null }>,
  arsenalScore: number | null,
): string {
  const ps = pitches.filter((p) => p.score != null).sort((a, b) => b.score! - a.score!);
  if (!ps.length) return "";
  const best = ps[0]!;
  const worst = ps[ps.length - 1]!;
  const bg = xaGrade(best.score)!;
  const b = `The ${xaPitchName(best.key)} is ${bg >= 70 ? "a weapon" : "the best pitch"} (${bg}, ${xaLabelText(xaLabel(best.score))})`;
  const w = ps.length > 1 && best.score! - worst.score! >= 5
    ? `; the ${xaPitchName(worst.key)} grades lowest (${xaGrade(worst.score)}, ${xaLabelText(xaLabel(worst.score))})`
    : "";
  return `${b}${w}. Overall the arsenal grades out ${xaLabelText(xaLabel(arsenalScore))} (${xaGrade(arsenalScore) ?? ""}).`;
}

/** Ryan's xaWhy, without the "Graded as a …" prefix (the UI shows subtype and blend itself). */
export function xaWhy(metrics: Array<{ key: string; score: number | null; importance: string | null }>): string {
  const ms = metrics.filter((m) => m.score != null && (m.importance === "primary" || m.importance === "secondary"));
  const strong = ms.filter((m) => m.score! >= 58).sort((a, b) => b.score! - a.score!);
  const weak = ms.filter((m) => m.score! < 45).sort((a, b) => a.score! - b.score!);
  const nm = (m: { key: string; score: number | null }) => `${XA_METRIC_LABEL[m.key] ?? m.key} (${m.score})`;
  const parts: string[] = [];
  if (strong.length) parts.push(`Carried by ${strong.slice(0, 2).map(nm).join(" and ")}.`);
  if (weak.length) parts.push(`Held back by ${weak.slice(0, 2).map(nm).join(" and ")}.`);
  if (!parts.length) parts.push("Grades out evenly — no key metric far above or below average.");
  return parts.join(" ");
}

export const xaSlotName = (a: number) => (a < 20 ? "Sidearm" : a < 35 ? "Low 3/4" : a < 50 ? "3/4" : a < 60 ? "High 3/4" : "Overhand");

/**
 * Ryan's slot line (display only, never changes a grade): count-weighted arm angle over the graded
 * pitches, else the Worker's slot; notes when the Worker graded on a different slot.
 */
export function xaSlotLine(
  inputs: Array<{ armAngle?: number | null; count?: number | null }>,
  slot: { angle: number | null; source: string | null } | null,
): string {
  let sum = 0;
  let w = 0;
  for (const p of inputs) if (p.armAngle != null && p.count) { sum += p.armAngle * p.count; w += p.count; }
  const all = w ? sum / w : null;
  const shown = all ?? slot?.angle ?? null;
  if (shown == null) return "";
  const note = all != null && slot?.angle != null && Math.round(all) !== Math.round(slot.angle) ? ` · grades use a ${Math.round(slot.angle)}° slot` : "";
  const est = all == null && slot?.source === "estimated" ? " (est. from release)" : "";
  return `${xaSlotName(shown)} · ${Math.round(shown)}° arm angle${all != null ? " (all pitches)" : ""}${est}${note}`;
}

/** Score colors (Ryan's xaClass / spClass) as Mantine color names. */
export function xaColor(score: number | null | undefined): string {
  if (score == null) return "gray";
  return score >= 60 ? "green" : score >= 50 ? "gray" : score >= 40 ? "yellow" : "red";
}
export function stuffPlusColor(v: number | null | undefined): string {
  if (v == null) return "gray";
  return v >= 110 ? "green" : v >= 95 ? "gray" : v >= 85 ? "yellow" : "red";
}
