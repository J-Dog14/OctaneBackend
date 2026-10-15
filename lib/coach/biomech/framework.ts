/**
 * 8-cylinder scoring and the written read for the in-app pitching report.
 *
 * Bands, thresholds and vocabulary come from the biomech-pitching-breakdown
 * skill (references/cylinders.md v12, benchmarks.md, coaching_language.md,
 * archetypes.md, cut_ride_diagnostic.md). The skill has Claude write the
 * narrative; here it is assembled from rules so the page updates by itself
 * when new captures land. Keep the language rules: no "trunk dump" / "fall
 * forward", no towel drills, arm-early is timing (never hypermobility),
 * arm-side / glove-side instead of base names.
 *
 * Pure: no database access.
 */

import type { EightCylMetrics } from "./extract";

export type Status = "best" | "good" | "warn" | "bad" | "neutral";

export interface CylinderCard {
  num: number;
  key: string;
  name: string;
  short: string;
  valueText: string;
  benchmarkText: string;
  status: Status;
  percentile: number | null;
}

export interface DetailMetric {
  group: string;
  label: string;
  valueText: string;
  refText: string;
  status: Status;
}

export interface Finding {
  heading: string;
  body: string;
}

export interface WrittenRead {
  summary: string;
  archetype: { name: string; note: string } | null;
  whatsWorking: Finding[];
  whereLeaking: Finding[];
  recommendations: Finding[];
  bottomLine: string;
  flags: string[];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export const f0 = (v: number | null | undefined, unit = "") => (v == null ? "—" : `${Math.round(v)}${unit}`);
export const f1 = (v: number | null | undefined, unit = "") => (v == null ? "—" : `${v.toFixed(1)}${unit}`);
export const f2 = (v: number | null | undefined, unit = "") => (v == null ? "—" : `${v.toFixed(2)}${unit}`);
const sgn0 = (v: number | null | undefined, unit = "") => (v == null ? "—" : `${v >= 0 ? "+" : ""}${Math.round(v)}${unit}`);

const RANK: Record<Status, number> = { bad: 0, warn: 1, neutral: 2, good: 3, best: 4 };
/** Worst status among known ones (neutral only when nothing is known). */
export function worst(...ss: Status[]): Status {
  const known = ss.filter((s) => s !== "neutral");
  if (!known.length) return "neutral";
  return known.reduce((a, b) => (RANK[b] < RANK[a] ? b : a));
}

// ---------------------------------------------------------------------------
// Bands (benchmarks.md + cylinders.md v12)
// ---------------------------------------------------------------------------

export const band = {
  stride: (v: number | null): Status => (v == null ? "neutral" : v >= 85 ? "best" : v >= 80 ? "good" : v >= 75 ? "warn" : "bad"),
  backGrf: (v: number | null): Status => (v == null ? "neutral" : v >= 1.7 ? "best" : v >= 1.5 ? "good" : v >= 1.3 ? "warn" : "bad"),
  trunkLinY: (v: number | null): Status => (v == null ? "neutral" : v >= 8.5 ? "best" : v >= 7.5 ? "good" : v >= 6.5 ? "warn" : "bad"),
  hss: (v: number | null): Status =>
    v == null ? "neutral" : v > 65 ? "warn" : v >= 50 ? "best" : v >= 40 ? "good" : v >= 30 ? "warn" : "bad",
  thorax: (v: number | null): Status => (v == null ? "neutral" : v >= 1200 ? "best" : v >= 1050 ? "good" : v >= 900 ? "warn" : "bad"),
  chain: (verdict: EightCylMetrics["cyl3"]["chainVerdict"], gain: number | null): Status =>
    verdict == null
      ? "neutral"
      : verdict === "clean_chain"
        ? gain != null && gain >= 40 && gain <= 80
          ? "best"
          : "good"
        : verdict === "weak_amplification" || verdict === "high_amplification"
          ? "warn"
          : "bad",
  kneeExt: (v: number | null): Status => (v == null ? "neutral" : v > 25 ? "good" : v >= 15 ? "best" : v >= 10 ? "warn" : "bad"),
  leadVertRelease: (v: number | null): Status => (v == null ? "neutral" : v >= 2.0 ? "best" : v >= 1.7 ? "good" : v >= 1.3 ? "warn" : "bad"),
  obliquity: (flag: EightCylMetrics["cyl5"]["stabilityFlag"], peak: number | null): Status =>
    flag == null ? "neutral" : flag === "unstable" ? "bad" : flag === "watch" ? "warn" : peak != null && peak < 8 ? "best" : "good",
  obliqSwing: (v: number | null): Status => (v == null ? "neutral" : Math.abs(v) < 20 ? "good" : "warn"),
  dwell: (v: number | null): Status => (v == null ? "neutral" : v >= 60 ? "best" : v >= 40 ? "good" : v >= 20 ? "warn" : "bad"),
  hzAbdFs: (v: number | null): Status => (v == null ? "neutral" : v <= -45 ? "best" : v <= -25 ? "good" : "warn"),
  erFs: (flag: EightCylMetrics["cyl7"]["erFsFlag"]): Status =>
    flag == null ? "neutral" : flag === "late" ? "best" : flag === "middle" ? "good" : flag === "arm_early" ? "warn" : "bad",
  mer: (v: number | null): Status => (v == null ? "neutral" : v >= 170 ? "good" : "warn"),
  torque: (v: number | null): Status => (v == null ? "neutral" : v > 130 ? "bad" : v > 120 ? "warn" : "good"),
  stress: (v: number | null): Status => (v == null ? "neutral" : v >= 1.35 ? "bad" : v > 1.2 ? "warn" : "good"),
  distraction: (v: number | null): Status => (v == null ? "neutral" : v >= 0.8 ? "good" : v >= 0.5 ? "warn" : "bad"),
  forwardFlex: (v: number | null): Status =>
    v == null ? "neutral" : v > 50 ? "warn" : v >= 40 ? "good" : v >= 30 ? "best" : v >= 25 ? "warn" : "bad",
  lateralTilt: (v: number | null): Status => (v == null ? "neutral" : v >= 30 && v <= 45 ? "best" : v > 45 ? "good" : v >= 25 ? "good" : v >= 15 ? "warn" : "bad"),
  pelvisStop: (v: number | null): Status => (v == null ? "neutral" : v < 140 ? "best" : v <= 180 ? "good" : "warn"),
  overshoot: (v: EightCylMetrics["pelvis"]["overshoot"]): Status => (v == null ? "neutral" : v === "heavy" ? "bad" : v === "mild" ? "warn" : "good"),
  recoil: (v: EightCylMetrics["pelvis"]["recoil"]): Status => (v == null ? "neutral" : v === "hard" ? "bad" : v === "moderate" ? "warn" : "good"),
  peaksBeforeMer: (pct: number | null): Status => (pct == null ? "neutral" : pct >= 80 ? "good" : pct >= 40 ? "warn" : "bad"),
};

const ER_LABEL: Record<NonNullable<EightCylMetrics["cyl7"]["erFsFlag"]>, string> = {
  extreme_late: "extreme late",
  late: "late arm",
  middle: "middle",
  arm_early: "arm-early",
};
const CHAIN_LABEL: Record<NonNullable<EightCylMetrics["cyl3"]["chainVerdict"]>, string> = {
  clean_chain: "clean chain",
  broken_sequence: "broken sequence",
  slow_trunk_catch: "slow trunk catch",
  weak_amplification: "weak amplification",
  high_amplification: "high amplification",
};

// ---------------------------------------------------------------------------
// Cohort percentiles
// ---------------------------------------------------------------------------

/** Headline numbers ranked against the cohort. */
export type CohortKey =
  | "stride" | "backGrf" | "trunkLinY" | "hssFs" | "thoraxPeak" | "chainGain" | "kneeExt" | "leadPeakVert"
  | "obliqPeak" | "dwell" | "hzAbdFs" | "stressPerMph" | "ffRel" | "ltRel" | "velo";
export type CohortRow = Partial<Record<CohortKey, number | null>>;

export function cohortRow(m: EightCylMetrics): CohortRow {
  return {
    stride: m.cyl1.stridePctHeight,
    backGrf: m.cyl1.backLegGrfMax,
    trunkLinY: m.cyl1.trunkLinYMph,
    hssFs: m.cyl2.hssFs,
    thoraxPeak: m.cyl3.thoraxPeak,
    chainGain: m.cyl3.chainGainPct,
    kneeExt: m.cyl4.leadKneeExtension,
    leadPeakVert: m.cyl4.leadPeakVerticalBw,
    obliqPeak: m.cyl5.obliquityPeakAbs,
    dwell: m.cyl6.dwellMs,
    hzAbdFs: m.cyl6.hzAbdFs,
    stressPerMph: m.cyl7.stressPerMph,
    ffRel: m.cyl8.forwardFlexRelease,
    ltRel: m.cyl8.lateralTiltRelease,
    velo: m.velocity.mean,
  };
}

/** Skill recipe: share of the cohort strictly worse than the target, 0–100. */
export function percentile(target: number | null | undefined, values: Array<number | null | undefined>, higherIsBetter = true): number | null {
  const clean = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (target == null || !clean.length) return null;
  const below = clean.filter((v) => (higherIsBetter ? v < target : v > target)).length;
  return Math.round((below / clean.length) * 100);
}

function meanPct(xs: Array<number | null>): number | null {
  const k = xs.filter((x): x is number => x != null);
  return k.length ? Math.round(k.reduce((a, b) => a + b, 0) / k.length) : null;
}

export interface CylinderPercentiles {
  c1: number | null; c2: number | null; c3: number | null; c4: number | null;
  c5: number | null; c6: number | null; c7: number | null; c8: number | null;
  overall: number | null;
  velo: number | null;
}

export function cylinderPercentiles(target: CohortRow, cohort: CohortRow[]): CylinderPercentiles {
  const p = (k: CohortKey, hib = true) => percentile(target[k], cohort.map((r) => r[k]), hib);
  const out = {
    c1: meanPct([p("stride"), p("backGrf"), p("trunkLinY")]),
    c2: p("hssFs"),
    c3: meanPct([p("thoraxPeak"), p("chainGain")]),
    c4: meanPct([p("kneeExt"), p("leadPeakVert")]),
    c5: p("obliqPeak", false),
    c6: meanPct([p("dwell"), p("hzAbdFs", false)]),
    c7: p("stressPerMph", false),
    c8: meanPct([p("ffRel"), p("ltRel")]),
  };
  return { ...out, overall: meanPct(Object.values(out)), velo: p("velo") };
}

// ---------------------------------------------------------------------------
// Cylinder cards + underlying metrics
// ---------------------------------------------------------------------------

export function cylinderCards(m: EightCylMetrics, pct: CylinderPercentiles | null): CylinderCard[] {
  const { cyl1, cyl2, cyl3, cyl4, cyl5, cyl6, cyl7, cyl8 } = m;
  const c4grf = cyl4.leadVertGrfRelease != null ? band.leadVertRelease(cyl4.leadVertGrfRelease) : "neutral";
  return [
    {
      num: 1, key: "c1", name: "Down-the-Mound Engine", short: "Down-Mound",
      valueText: `Stride ${f0(cyl1.stridePctHeight, "%")} of height · Back GRF ${f2(cyl1.backLegGrfMax, " BW")} · Trunk ${f1(cyl1.trunkLinYMph, " mph")}`,
      benchmarkText: "Elite: stride 85–90% · back GRF 1.6–1.8 BW · trunk 8+ mph down the mound",
      status: worst(band.stride(cyl1.stridePctHeight), band.backGrf(cyl1.backLegGrfMax), band.trunkLinY(cyl1.trunkLinYMph)),
      percentile: pct?.c1 ?? null,
    },
    {
      num: 2, key: "c2", name: "Hip–Shoulder Separation", short: "HSS",
      valueText: `${f0(cyl2.hssFs, "°")} at footstrike · ${f0(cyl2.hssRelease, "°")} at release`,
      benchmarkText: "Elite: 40–60° at footstrike (>65° can be a compensation)",
      status: band.hss(cyl2.hssFs),
      percentile: pct?.c2 ?? null,
    },
    {
      num: 3, key: "c3", name: "Trunk Velocity Into Release", short: "Trunk Vel",
      valueText: `Chain gain ${sgn0(cyl3.chainGainPct, "%")} · lag ${f0(cyl3.chainLagMs, " ms")} · thorax ${f0(cyl3.thoraxPeak, " °/s")}`,
      benchmarkText: "Elite: gain 40–80% · lag 30–70 ms · thorax 1,200–1,500 °/s",
      status: worst(band.chain(cyl3.chainVerdict, cyl3.chainGainPct), cyl3.thoraxPeak != null && cyl3.thoraxPeak < 900 ? "warn" : "neutral"),
      percentile: pct?.c3 ?? null,
    },
    {
      num: 4, key: "c4", name: "Front Leg Block & Force", short: "Front Block",
      valueText: `Knee extension ${sgn0(cyl4.leadKneeExtension, "°")} FS→release${
        cyl4.leadPeakVerticalBw != null ? ` · peak vertical ${f2(cyl4.leadPeakVerticalBw, " BW")}` : cyl4.leadVertGrfRelease != null ? ` · ${f2(cyl4.leadVertGrfRelease, " BW")} at release` : ""
      }`,
      benchmarkText: "Elite: 15–25° extension · 2.0+ BW vertical into release",
      status: worst(band.kneeExt(cyl4.leadKneeExtension), c4grf),
      percentile: pct?.c4 ?? null,
    },
    {
      num: 5, key: "c5", name: "Pelvis Stability & Obliquity", short: "Pelvis Stab",
      valueText: `Peak obliquity ${f1(cyl5.obliquityPeakAbs, "°")} · swing FS→release ${sgn0(cyl5.obliquitySwing, "°")}`,
      benchmarkText: "Stable: < 15° at every event · swing < 20°",
      status: worst(band.obliquity(cyl5.stabilityFlag, cyl5.obliquityPeakAbs), band.obliqSwing(cyl5.obliquitySwing)),
      percentile: pct?.c5 ?? null,
    },
    {
      num: 6, key: "c6", name: "Horizontal Abduction / Arm Trail", short: "Arm Trail",
      valueText: `${f0(cyl6.hzAbdFs, "°")} at footstrike · dwell ${f0(cyl6.dwellMs, " ms")} at ≤ −20°`,
      benchmarkText: "Elite: −45° to −70° at FS · dwell 40–80 ms",
      status: cyl6.dwellMs != null ? band.dwell(cyl6.dwellMs) : band.hzAbdFs(cyl6.hzAbdFs),
      percentile: pct?.c6 ?? null,
    },
    {
      num: 7, key: "c7", name: "Arm Health", short: "Arm Health",
      valueText: `ER@FS ${f0(cyl7.erFs, "°")}${cyl7.erFsFlag ? ` (${ER_LABEL[cyl7.erFsFlag]})` : ""} · MER ${f0(cyl7.mer, "°")} · ${f0(cyl7.elbowTorqueMerNm, " Nm")} (${f2(cyl7.stressPerMph, " Nm/mph")})`,
      benchmarkText: "Late arm 10–33° ER@FS · MER 170–190° · < 1.2 Nm/mph",
      status: worst(band.erFs(cyl7.erFsFlag), band.stress(cyl7.stressPerMph), band.torque(cyl7.elbowTorqueMerNm)),
      percentile: pct?.c7 ?? null,
    },
    {
      num: 8, key: "c8", name: "Posture at Ball Release", short: "Posture",
      valueText: `Forward flex ${f0(cyl8.forwardFlexRelease, "°")} · lateral tilt ${f0(cyl8.lateralTiltRelease, "°")}`,
      benchmarkText: "Elite: forward 30–40° · lateral 30–45°",
      status: worst(band.forwardFlex(cyl8.forwardFlexRelease), band.lateralTilt(cyl8.lateralTiltRelease)),
      percentile: pct?.c8 ?? null,
    },
  ];
}

export function detailMetrics(m: EightCylMetrics): DetailMetric[] {
  const rows: DetailMetric[] = [
    { group: "Engine", label: "Stride length (% height)", valueText: f1(m.cyl1.stridePctHeight, "%"), refText: "85–90% elite · < 75% flag", status: band.stride(m.cyl1.stridePctHeight) },
    { group: "Engine", label: "Back-leg peak GRF", valueText: f2(m.cyl1.backLegGrfMax, " BW"), refText: "1.6–1.8 BW elite", status: band.backGrf(m.cyl1.backLegGrfMax) },
    { group: "Engine", label: "Back knee FS → MER", valueText: `${f0(m.cyl1.backKneeFs, "°")} → ${f0(m.cyl1.backKneeMer, "°")}`, refText: "controlled flexion = absorber", status: m.cyl1.deltaBackKneeFsToMer == null ? "neutral" : m.cyl1.deltaBackKneeFsToMer > 0 ? "good" : "warn" },
    { group: "Engine", label: "Pelvis linear vel (toward home)", valueText: f1(m.cyl1.pelvisLinYMph, " mph"), refText: "~6–8 mph", status: m.cyl1.pelvisLinYMph == null ? "neutral" : m.cyl1.pelvisLinYMph >= 6 ? "good" : "warn" },
    { group: "Engine", label: "Trunk linear vel (toward home)", valueText: f1(m.cyl1.trunkLinYMph, " mph"), refText: "7.5+ good · 8.5+ elite", status: band.trunkLinY(m.cyl1.trunkLinYMph) },
    { group: "Separation", label: "HSS @ footstrike", valueText: f0(m.cyl2.hssFs, "°"), refText: "40–60° · > 65° watch", status: band.hss(m.cyl2.hssFs) },
    { group: "Chain", label: "Peak pelvis ang vel", valueText: f0(m.cyl3.pelvisPeak, " °/s"), refText: "770–900 °/s", status: m.cyl3.pelvisPeak == null ? "neutral" : m.cyl3.pelvisPeak >= 770 ? "best" : m.cyl3.pelvisPeak >= 650 ? "good" : "warn" },
    { group: "Chain", label: "Peak thorax ang vel", valueText: f0(m.cyl3.thoraxPeak, " °/s"), refText: "1,200–1,500 °/s", status: band.thorax(m.cyl3.thoraxPeak) },
    { group: "Chain", label: "Chain gain (trunk over pelvis)", valueText: sgn0(m.cyl3.chainGainPct, "%"), refText: "40–80% elite · < 20% weak", status: band.chain(m.cyl3.chainVerdict, m.cyl3.chainGainPct) },
    { group: "Chain", label: "Chain lag (pelvis → trunk peak)", valueText: f0(m.cyl3.chainLagMs, " ms"), refText: "30–70 ms · < 10 broken · > 120 slow", status: m.cyl3.chainLagMs == null ? "neutral" : m.cyl3.chainLagMs < 10 || m.cyl3.chainLagMs > 120 ? "bad" : m.cyl3.chainLagMs >= 30 && m.cyl3.chainLagMs <= 70 ? "best" : "good" },
    { group: "Block", label: "Lead knee FS → release", valueText: `${f0(m.cyl4.leadKneeFs, "°")} → ${f0(m.cyl4.leadKneeRelease, "°")} (${sgn0(m.cyl4.leadKneeExtension, "°")})`, refText: "15–25° extension", status: band.kneeExt(m.cyl4.leadKneeExtension) },
  ];
  if (m.cyl4.leadVertGrfRelease != null) {
    rows.push({ group: "Block", label: "Lead vertical GRF @ release", valueText: f2(m.cyl4.leadVertGrfRelease, " BW"), refText: "≥ 2.0 BW elite", status: band.leadVertRelease(m.cyl4.leadVertGrfRelease) });
  }
  if (m.hasForcePlate) {
    rows.push(
      { group: "Block", label: "Lead peak vertical GRF", valueText: f2(m.cyl4.leadPeakVerticalBw, " BW"), refText: "force plate · peak FC→release", status: m.cyl4.leadPeakVerticalBw == null ? "neutral" : m.cyl4.leadPeakVerticalBw >= 2.0 ? "good" : "warn" },
      { group: "Block", label: "Lead peak braking GRF", valueText: f2(m.cyl4.leadPeakBrakingBw, " BW"), refText: "force plate", status: "neutral" },
      { group: "Block", label: "Lead peaks before MER", valueText: m.cyl4.peaksBeforeMerPct == null ? "—" : `${Math.round(m.cyl4.peaksBeforeMerPct)}% of throws`, refText: "peaks should land early, then decay", status: band.peaksBeforeMer(m.cyl4.peaksBeforeMerPct) },
    );
  }
  rows.push(
    { group: "Pelvis", label: "Pelvic obliquity FS / MER / release", valueText: `${f0(m.cyl5.obliquityFs, "°")} / ${f0(m.cyl5.obliquityMer, "°")} / ${f0(m.cyl5.obliquityRelease, "°")}`, refText: "< 15° stable · > 25° unstable", status: band.obliquity(m.cyl5.stabilityFlag, m.cyl5.obliquityPeakAbs) },
    { group: "Pelvis", label: "Pelvis stop after FS", valueText: f0(m.pelvis.stopAfterFsMs, " ms"), refText: "< 140 ms elite · > 180 late", status: band.pelvisStop(m.pelvis.stopAfterFsMs) },
    { group: "Pelvis", label: "Pelvis position at stop", valueText: f0(m.pelvis.angleStop, "°"), refText: "−10° to +5° stable · < −25° overshoot", status: band.overshoot(m.pelvis.overshoot) },
    { group: "Pelvis", label: "Pelvis ang vel @ release (recoil)", valueText: f0(m.pelvis.angVelRelease, " °/s"), refText: "> −50 °/s settled · < −100 hard recoil", status: band.recoil(m.pelvis.recoil) },
    { group: "Arm", label: "Horizontal abduction @ FS", valueText: f0(m.cyl6.hzAbdFs, "°"), refText: "−45° to −70° elite trail", status: band.hzAbdFs(m.cyl6.hzAbdFs) },
    { group: "Arm", label: "Arm-trail dwell (≤ −20°)", valueText: f0(m.cyl6.dwellMs, " ms"), refText: "≥ 60 elite · 40–60 strength", status: band.dwell(m.cyl6.dwellMs) },
    { group: "Arm", label: "External rotation @ FS (arm timing)", valueText: `${f0(m.cyl7.erFs, "°")}${m.cyl7.erFsFlag ? ` · ${ER_LABEL[m.cyl7.erFsFlag]}` : ""}`, refText: "< 10 extreme late · 10–33 late · > 80 early", status: band.erFs(m.cyl7.erFsFlag) },
    { group: "Arm", label: "Max external rotation (MER)", valueText: f0(m.cyl7.mer, "°"), refText: "170–190° elite lay-back", status: band.mer(m.cyl7.mer) },
    { group: "Arm", label: "Elbow varus torque @ MER", valueText: f0(m.cyl7.elbowTorqueMerNm, " Nm"), refText: "80–110 safe · > 130 caution", status: band.torque(m.cyl7.elbowTorqueMerNm) },
    { group: "Arm", label: "Stress per mph", valueText: f2(m.cyl7.stressPerMph, " Nm/mph"), refText: "≤ 1.2 healthy · ≥ 1.35 elevated", status: band.stress(m.cyl7.stressPerMph) },
    { group: "Arm", label: "Shoulder distraction", valueText: f2(m.cyl7.shoulderDistractionBw, " BW"), refText: "0.8–1.1 BW game effort", status: band.distraction(m.cyl7.shoulderDistractionBw) },
    { group: "Posture", label: "Trunk forward flex @ release", valueText: `${f0(m.cyl8.forwardFlexRelease, "°")} (FS ${f0(m.cyl8.forwardFlexFs, "°")})`, refText: "30–40° elite · < 25° upright", status: band.forwardFlex(m.cyl8.forwardFlexRelease) },
    { group: "Posture", label: "Trunk lateral tilt @ release", valueText: `${f0(m.cyl8.lateralTiltRelease, "°")} (FS ${f0(m.cyl8.lateralTiltFs, "°")})`, refText: "30–45° elite", status: band.lateralTilt(m.cyl8.lateralTiltRelease) },
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Written read
// ---------------------------------------------------------------------------

function archetype(m: EightCylMetrics, cards: CylinderCard[]): WrittenRead["archetype"] {
  const s = Object.fromEntries(cards.map((c) => [c.key, c.status])) as Record<string, Status>;
  const stress = m.cyl7.stressPerMph;
  const allGood = cards.every((c) => c.status === "good" || c.status === "best" || c.status === "neutral");
  if (allGood && (stress == null || stress <= 1.25)) {
    return { name: "Model Arm", note: "Every cylinder is in band with healthy stress per mph. Don't rebuild — additive work only; the risk of “improving” this delivery is breaking the chain efficiency." };
  }
  if ((s.c4 === "warn" || s.c4 === "bad") && stress != null && stress >= 1.35) {
    return { name: "Arm Thrower (compensating)", note: "Soft block with elevated stress per mph — the arm is paying the chain's tax. Address the upstream leak (block, drive leg, sequencing) before pushing velocity; the arm is the symptom, not the cause." };
  }
  if (m.cyl1.stridePctHeight != null && m.cyl1.stridePctHeight < 75 && m.cyl2.hssFs != null && m.cyl2.hssFs > 65) {
    return { name: "Short-Strider Compensator", note: "Short stride with hyper-separation — the pelvis is rotating early to find timing. Lengthen the stride first; the separation should moderate." };
  }
  if (m.cyl8.forwardFlexRelease != null && m.cyl8.forwardFlexRelease < 25 && m.cyl1.trunkLinYMph != null && m.cyl1.trunkLinYMph < 8) {
    return { name: "Quiet Trunk", note: "Upright finish with modest trunk speed down the mound — velocity is coming from pelvis and arm with the trunk as a passive link. Stride and front-leg block work usually pull trunk flex along with them." };
  }
  if (m.cyl8.forwardFlexRelease != null && m.cyl8.forwardFlexRelease > 50 && m.cyl3.chainGainPct != null && m.cyl3.chainGainPct < 25) {
    return { name: "Trunk-Accelerator", note: "Big forward flex at release with an under-amplified rotational chain — the trunk is compensating. Widen the pelvis-to-trunk peak gap and the extreme flex should moderate." };
  }
  if (m.pelvis.angVelFs != null && m.pelvis.angVelFs >= 200 && (m.cyl2.hssFs ?? 0) >= 50 && (m.cyl3.chainGainPct ?? 0) >= 40 && m.cyl7.erFsFlag === "late") {
    return { name: "Rubber Band", note: "Early pelvis, late arm, big separation and clean amplification — the elite-velocity pattern. Maintenance, not change." };
  }
  if (m.pelvis.angVelFs != null && m.pelvis.angVelFs < 200 && (m.cyl3.chainGainPct ?? 100) < 20 && m.cyl7.erFsFlag === "late") {
    return { name: "Sequenced Thrower", note: "Late pelvis and late arm firing as a compressed unit with little trunk amplification. The engine is there — fix the timing so separation can build." };
  }
  return null;
}

const WORKING: Record<string, (m: EightCylMetrics) => Finding> = {
  c1: (m) => ({ heading: "The engine down the mound", body: `Stride is ${f0(m.cyl1.stridePctHeight, "%")} of height with ${f2(m.cyl1.backLegGrfMax, " BW")} off the back leg, and the trunk travels ${f1(m.cyl1.trunkLinYMph, " mph")} toward home. That is real input into everything above it.` }),
  c2: (m) => ({ heading: "Loaded separation at landing", body: `${f0(m.cyl2.hssFs, "°")} of hip–shoulder separation at footstrike — the trunk is holding closed against a rotating pelvis, so the spring is loaded when the foot lands.` }),
  c3: (m) => ({ heading: "The trunk catches and amplifies the pelvis", body: `The trunk adds ${sgn0(m.cyl3.chainGainPct, "%")} on top of the pelvis and peaks ${f0(m.cyl3.chainLagMs, " ms")} after it (${m.cyl3.chainVerdict ? CHAIN_LABEL[m.cyl3.chainVerdict] : "—"}). Peak thorax speed is ${f0(m.cyl3.thoraxPeak, " °/s")}.` }),
  c4: (m) => ({ heading: "A front leg the trunk can fire against", body: `The lead knee extends ${sgn0(m.cyl4.leadKneeExtension, "°")} from footstrike to release${m.cyl4.leadPeakVerticalBw != null ? ` with ${f2(m.cyl4.leadPeakVerticalBw, " BW")} peak vertical force` : ""} — a stiff post for the trunk to accelerate against.` }),
  c5: (m) => ({ heading: "Stable pelvis platform", body: `Pelvic obliquity stays within ${f0(m.cyl5.obliquityPeakAbs, "°")} through footstrike, MER and release, so the trunk has a solid base to rotate on.` }),
  c6: (m) => ({ heading: "Arm trail and dwell", body: `The humerus sits ${f0(m.cyl6.hzAbdFs, "°")} behind the body at footstrike and holds ≤ −20° for ${f0(m.cyl6.dwellMs, " ms")} — the hard-thrower signature of an arm that loads behind the body while the chain unloads.` }),
  c7: (m) => ({ heading: "Arm timing and load", body: `ER at footstrike is ${f0(m.cyl7.erFs, "°")} (${m.cyl7.erFsFlag ? ER_LABEL[m.cyl7.erFsFlag] : "—"}), MER ${f0(m.cyl7.mer, "°")}, and the elbow sees ${f2(m.cyl7.stressPerMph, " Nm per mph")} — the arm is being delivered by the chain, not doing rescue work.` }),
  c8: (m) => ({ heading: "Full-body finish", body: `The trunk finishes over the front leg with ${f0(m.cyl8.forwardFlexRelease, "°")} forward flex and ${f0(m.cyl8.lateralTiltRelease, "°")} lateral tilt — evidence the trunk fired concentrically into release.` }),
};

function leak(key: string, m: EightCylMetrics): Finding {
  switch (key) {
    case "c1": {
      const parts: string[] = [];
      if (band.stride(m.cyl1.stridePctHeight) === "warn" || band.stride(m.cyl1.stridePctHeight) === "bad") parts.push(`stride is ${f0(m.cyl1.stridePctHeight, "%")} of height (elite 85–90%)`);
      if (band.backGrf(m.cyl1.backLegGrfMax) === "warn" || band.backGrf(m.cyl1.backLegGrfMax) === "bad") parts.push(`back-leg drive peaks at ${f2(m.cyl1.backLegGrfMax, " BW")} (elite 1.6–1.8)`);
      if (band.trunkLinY(m.cyl1.trunkLinYMph) === "warn" || band.trunkLinY(m.cyl1.trunkLinYMph) === "bad") parts.push(`the trunk only travels ${f1(m.cyl1.trunkLinYMph, " mph")} toward home`);
      return { heading: "Input down the mound", body: `${parts.length ? parts.join(", ") : "The engine reads below band"}. This is the engine cylinder — less input here caps everything above it.` };
    }
    case "c2":
      return (m.cyl2.hssFs ?? 0) > 65
        ? { heading: "Hyper-separation at landing", body: `${f0(m.cyl2.hssFs, "°")} at footstrike is past the 40–60° band. Big separation can be a compensation for a short stride or an early-rotating pelvis rather than a strength — read it alongside Cylinders 1 and 5.` }
        : { heading: "The spring isn't fully loaded", body: `Only ${f0(m.cyl2.hssFs, "°")} of separation at footstrike (40–60° band). The trunk is opening with the pelvis instead of holding closed, so there is less stretch for the trunk to release through.${m.cyl8.forwardFlexFs != null && m.cyl8.forwardFlexFs < 5 ? ` The trunk also arrives at footstrike nearly upright (${f0(m.cyl8.forwardFlexFs, "°")} forward flex) — no pre-load.` : ""}` };
    case "c3": {
      const v = m.cyl3.chainVerdict;
      const body =
        v === "broken_sequence"
          ? `The trunk peaks ${f0(Math.abs(m.cyl3.chainLagMs ?? 0), " ms")} ${(m.cyl3.chainLagMs ?? 0) < 0 ? "before" : "after"} the pelvis — it fires without waiting for the pelvis to hand off, and adds only ${sgn0(m.cyl3.chainGainPct, "%")}.`
          : v === "slow_trunk_catch"
            ? `${f0(m.cyl3.chainLagMs, " ms")} between pelvis and trunk peaks is too slow a catch (elite 30–70 ms) — the pelvis has already given up its speed by the time the trunk fires.`
            : v === "weak_amplification"
              ? `The trunk adds only ${sgn0(m.cyl3.chainGainPct, "%")} over the pelvis (elite 40–80%). Energy the pelvis produces isn't being multiplied at the trunk.`
              : v === "high_amplification"
                ? `A ${sgn0(m.cyl3.chainGainPct, "%")} chain gain is unusually high — usually a sign of a low-output pelvis (${f0(m.cyl3.pelvisPeak, " °/s")}) rather than an elite trunk.`
                : `Peak thorax speed is ${f0(m.cyl3.thoraxPeak, " °/s")} (elite 1,200–1,500) — the arm has to do more of the work.`;
      return { heading: "Trunk contribution into release", body };
    }
    case "c4": {
      const ext = m.cyl4.leadKneeExtension;
      const late = m.cyl4.peaksBeforeMerPct != null && m.cyl4.peaksBeforeMerPct < 50;
      return {
        heading: "Front-leg block",
        body: `${ext != null && ext < 0 ? `The lead knee flexes ${f0(Math.abs(ext), "°")} instead of extending` : `The lead knee extends only ${sgn0(ext, "°")}`} from footstrike to release (elite 15–25°)${late ? `, and the lead-leg force peaks land after MER on ${Math.round(100 - (m.cyl4.peaksBeforeMerPct ?? 0))}% of throws — the lower body is still working when the upper body should be firing` : ""}. Without a stiff post the trunk has nothing to accelerate against.`,
      };
    }
    case "c5":
      return { heading: "Pelvis stability", body: `Pelvic obliquity reaches ${f1(m.cyl5.obliquityPeakAbs, "°")} (stable < 15°) with a ${sgn0(m.cyl5.obliquitySwing, "°")} swing from footstrike to release. An unstable platform shows up downstream as leaks in separation, chain amplification and release consistency.` };
    case "c6":
      return { heading: "Arm trail", body: `The humerus is ${f0(m.cyl6.hzAbdFs, "°")} at footstrike and holds ≤ −20° for ${f0(m.cyl6.dwellMs, " ms")} (elite 40–80 ms). The arm isn't staying behind the body while the chain unloads.` };
    case "c7": {
      const bits: string[] = [];
      if (m.cyl7.erFsFlag === "extreme_late") bits.push(`ER at footstrike is ${f0(m.cyl7.erFs, "°")} — extreme late. The arm must travel the full lay-back range in the short footstrike-to-MER window, which spikes stress on the shoulder and elbow`);
      if (m.cyl7.erFsFlag === "arm_early") bits.push(`ER at footstrike is ${f0(m.cyl7.erFs, "°")} — arm-early. The arm begins its throw before the chain has loaded it; this is a timing issue and it is trainable`);
      if (band.stress(m.cyl7.stressPerMph) !== "good" && m.cyl7.stressPerMph != null) bits.push(`elbow load is ${f2(m.cyl7.stressPerMph, " Nm per mph")} (${f0(m.cyl7.elbowTorqueMerNm, " Nm")}) — the arm is doing rescue work`);
      if (band.torque(m.cyl7.elbowTorqueMerNm) === "bad") bits.push(`elbow varus torque of ${f0(m.cyl7.elbowTorqueMerNm, " Nm")} is in the caution range`);
      return { heading: "Arm health", body: `${bits.length ? bits.join("; ") : "Arm health markers are out of band"}.` };
    }
    case "c8":
    default: {
      const ff = m.cyl8.forwardFlexRelease;
      return {
        heading: "Posture at release",
        body:
          ff != null && ff > 50
            ? `${f0(ff, "°")} forward flex at release is very aggressive — verify on video and read it with the chain numbers; extreme flex often compensates for an under-amplified rotational chain.`
            : `The trunk finishes at ${f0(ff, "°")} forward flex and ${f0(m.cyl8.lateralTiltRelease, "°")} lateral tilt (elite 30–40° / 30–45°). An upright finish means the trunk's contribution to the throw was small.`,
      };
    }
  }
}

const RECS: Record<string, (m: EightCylMetrics) => Finding> = {
  c1: (m) => ({ heading: "Drive down the mound", body: `Lateral bounds with stiff landings, rear-leg single-leg RDLs and hex-bar jumps for back-leg output; mound work cueing a longer, more aggressive stride. Targets: stride from ${f0(m.cyl1.stridePctHeight, "%")} toward 85%, back-leg GRF toward 1.6+ BW.` }),
  c4: (m) => ({ heading: "Post up the front leg", body: `Box-blast drills, ISO knee holds at footstrike position and trap-bar pulls. Cue: lock out the lead knee through release. Target: ${sgn0(m.cyl4.leadKneeExtension, "°")} toward 15–25° of extension from footstrike to release.` }),
  c5: () => ({ heading: "Stabilize the pelvis", body: "Pallof press progressions, suitcase carries and banded hold-and-hinges to own the frontal plane. Target: obliquity under 15° at footstrike, MER and release." }),
  c2: (m) => ((m.cyl2.hssFs ?? 0) > 65
    ? { heading: "Let separation settle", body: "Address stride length and pelvis timing first (Cylinders 1 and 5); hyper-separation should moderate on its own. Avoid cueing more separation." }
    : { heading: "Load separation into landing", body: `Connection-ball work, banded pelvis pivots, rocker-step variations and hockey / lateral med-ball throws. Target: ${f0(m.cyl2.hssFs, "°")} toward 40–60° at footstrike.` }),
  c3: (m) => ({ heading: "Trunk acceleration into release", body: `Med-ball rotational throws (lateral, scoop), plyo-ball overload/underload and heavy-ball decel work to load the trunk eccentrically off the pelvis decel and fire it concentrically. Targets: chain gain from ${sgn0(m.cyl3.chainGainPct, "%")} toward 40–80% with a 30–70 ms lag.` }),
  c8: (m) => ({ heading: "Finish over the front leg", body: `ISO holds at the finish position and med-ball scoop throws. Forward flex at release (${f0(m.cyl8.forwardFlexRelease, "°")} now) should move toward 30–40° as the evidence the trunk is firing — it is the outcome, not the cue.` }),
  c6: (m) => ({ heading: "Hold the arm trail", body: `Connection-ball work and banded plyo throws with an arm-hold cue, plus cuff/scap mobility. Target: dwell at ≤ −20° from ${f0(m.cyl6.dwellMs, " ms")} toward 40–60 ms.` }),
  c7: (m) => ({
    heading: m.cyl7.erFsFlag === "arm_early" ? "Fix arm timing" : m.cyl7.erFsFlag === "extreme_late" ? "Start the lay-back earlier" : "Take load off the elbow",
    body:
      m.cyl7.erFsFlag === "arm_early"
        ? `Tempo work, connection-ball and med-ball drills so the chain loads the arm. Target ER at footstrike from ${f0(m.cyl7.erFs, "°")} toward 10–33°. This is timing, not a joint-range issue.`
        : m.cyl7.erFsFlag === "extreme_late"
          ? `Tempo work to begin loading the arm slightly earlier — target ER at footstrike in the 20–33° range, not all the way into the middle band. Monitor arm health closely.`
          : `Fix the upstream leak first (block, separation, trunk) so the chain delivers the arm. Target stress per mph from ${f2(m.cyl7.stressPerMph)} toward ≤ 1.2.`,
  }),
};

/** Upstream first: engine → block → pelvis → separation → trunk → posture → arm. */
const ORDER = ["c1", "c4", "c5", "c2", "c3", "c8", "c6", "c7"];

export function writtenRead(name: string, m: EightCylMetrics, cards: CylinderCard[], pct: CylinderPercentiles | null, cohortN: number): WrittenRead {
  const byKey = Object.fromEntries(cards.map((c) => [c.key, c]));
  const strengths = cards.filter((c) => c.status === "best" || c.status === "good");
  const leaks = ORDER.map((k) => byKey[k]!).filter((c) => c.status === "warn" || c.status === "bad");
  const arche = archetype(m, cards);

  const flags: string[] = [];
  if (m.cyl7.shoulderDistractionBw != null && m.cyl7.shoulderDistractionBw < 0.5) {
    flags.push(`Shoulder distraction is ${f2(m.cyl7.shoulderDistractionBw, " BW")} — likely a sub-max capture. Treat velocity-linked reads with caution and consider a re-test.`);
  }
  if (m.velocity.count > 1 && m.velocity.sd < 0.3) flags.push(`Velocity spread is very tight (SD ${f2(m.velocity.sd)} mph) — check capture effort.`);
  if (m.cyl7.erFsFlag === "extreme_late") flags.push("ER at footstrike is under 10° — extreme late arm. Monitor arm health.");

  const v = m.velocity;
  const first = `${name} averaged ${f1(v.mean, " mph")} across ${v.count} fastball${v.count === 1 ? "" : "s"}${v.count > 1 ? ` (SD ${f2(v.sd)}, range ${f1(v.min)}–${f1(v.max)})` : ""}${pct?.overall != null ? `, ${ordinal(pct.overall)} percentile overall against ${cohortN} pitchers in the database` : ""}.`;
  const strong = strengths.length
    ? ` The strengths are ${listify(strengths.slice(0, 3).map((c) => c.name.toLowerCase()))}.`
    : "";
  const leakTxt = leaks.length
    ? ` The main place velocity is leaking is ${leaks[0]!.name.toLowerCase()} (Cylinder ${leaks[0]!.num})${leaks.length > 1 ? `, followed by ${listify(leaks.slice(1, 3).map((c) => c.name.toLowerCase()))}` : ""}.`
    : " Nothing reads out of band.";
  const archTxt = arche ? ` Pattern: ${arche.name}.` : "";
  const summary = first + strong + leakTxt + archTxt;

  const whatsWorking = strengths.slice(0, 4).map((c) => WORKING[c.key]!(m));
  const whereLeaking = leaks.map((c) => leak(c.key, m));

  // Release-phase and pelvis diagnostics ride along with the leaks when they flag.
  if (m.pelvis.overshoot === "heavy" || m.pelvis.recoil === "hard") {
    const parts: string[] = [];
    if (m.pelvis.overshoot === "heavy") parts.push(`The pelvis stops at ${f0(m.pelvis.angleStop, "°")}, well past the stable −10° to +5° landing spot`);
    if (m.pelvis.recoil === "hard") parts.push(`it is counter-rotating at ${f0(m.pelvis.angVelRelease, " °/s")} as the ball leaves`);
    whereLeaking.push({
      heading: m.pelvis.recoil === "hard" ? "Pelvis overshoot and recoil" : "Pelvis overshoot",
      body: `${parts.join(", and ")}. Every degree past the stable stop${m.pelvis.recoil === "hard" ? " and every degree of recoil" : ""} is energy escaping back into the lower body instead of staying in the chain.`,
    });
  }
  const rp = m.releasePhase;
  if (rp.pronationFlag === "cut_risk" || rp.irFlag === "cut_risk") {
    const why: string[] = [];
    if (rp.pronationFlag === "cut_risk") why.push(`pronation peaks ${sgn0(rp.pronationOffsetMs, " ms")} after release (clean is +25 to +50), so the forearm is still supinated when the ball leaves`);
    if (rp.irFlag === "cut_risk") why.push(`${f0(rp.pctIrBeforeRelease, "%")} of internal rotation happens before release (clean < 50%), dragging the fingers toward the glove side`);
    whereLeaking.push({
      heading: "Release phase: cut risk",
      body: `${cap(why.join("; "))}. Both bias the fastball toward cut regardless of how clean the chain is.${rp.tiltModifier === "amplified_cut" ? " A high slot with a deep arm trail amplifies it." : ""}`,
    });
  }

  const recKeys = leaks.map((c) => c.key);
  const recommendations = recKeys.map((k) => RECS[k]!(m)).slice(0, 5);
  if (!recommendations.length) {
    recommendations.push({ heading: "Additive velocity work", body: "Nothing in the framework is out of band. Keep the chain intact — progressive intent and plyo-ball overload/underload rather than mechanical changes." });
  }

  const bottomLine = leaks.length
    ? `${arche ? `${arche.note} ` : ""}Start upstream with ${byKey[recKeys[0]!]!.name.toLowerCase()}; the downstream cylinders${recKeys.length > 1 ? ` (${listify(recKeys.slice(1).map((k) => byKey[k]!.name.toLowerCase()))})` : ""} usually move with it. Re-capture after a training block to confirm the change shows up in the numbers.`
    : `${arche ? `${arche.note} ` : ""}Every cylinder reads in band. Protect what is working and chase velocity with intent, not rebuilds.`;

  return { summary, archetype: arche, whatsWorking, whereLeaking, recommendations, bottomLine, flags };
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function listify(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
