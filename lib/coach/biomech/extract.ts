/**
 * 8-cylinder metric extraction, ported from the biomech-pitching-breakdown
 * skill (scripts/extract_metrics.py, framework v12/v13) so the in-app report
 * reads the same numbers the skill does.
 *
 * Input is the warehouse's per-trial Visual3D export (f_pitching_trials.metrics,
 * keys "FOLDER.Variable.Component" → [value]) plus the force-plate layer
 * (f_pitching_force_metrics). Metric ids below use the skill's B_Young names
 * (`Trunk_Angle@Release_X`, `STRIDE_LENGTH_MEAN_PERCENT`); `TrialLookup`
 * resolves them against the warehouse keys regardless of folder.
 *
 * Pure: no database access, so it can be tested on its own.
 */

export type TrialMetricsJson = Record<string, unknown>;

/** One trial's metrics, addressable by the skill's metric ids. */
export class TrialLookup {
  private readonly map = new Map<string, number>();

  constructor(metrics: TrialMetricsJson) {
    // PROCESSED wins when a variable appears in several folders.
    const entries = Object.entries(metrics).sort(([a], [b]) => Number(b.startsWith("PROCESSED.")) - Number(a.startsWith("PROCESSED.")));
    for (const [key, raw] of entries) {
      const first = key.indexOf(".");
      const last = key.lastIndexOf(".");
      if (first < 0) continue;
      let name: string;
      let comp: string;
      if (last > first && /^[XYZ]$/.test(key.slice(last + 1))) {
        name = key.slice(first + 1, last);
        comp = key.slice(last + 1);
      } else {
        name = key.slice(first + 1);
        comp = "X";
      }
      const k = `${name}|${comp}`;
      if (this.map.has(k)) continue;
      const v = firstNumber(raw);
      if (v != null) this.map.set(k, v);
    }
  }

  /** `Trunk_Angle@Release_X` → Trunk_Angle@Release / X; `STRIDE_LENGTH_MEAN_PERCENT` → X component. */
  get(id: string): number | null {
    const direct = this.map.get(`${id}|X`);
    if (direct != null) return direct;
    const m = /^(.*)_([XYZ])$/.exec(id);
    if (m) {
      const v = this.map.get(`${m[1]}|${m[2]}`);
      if (v != null) return v;
    }
    return null;
  }
}

function firstNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(raw)) {
    for (const x of raw) {
      const n = firstNumber(x);
      if (n != null) return n;
    }
  }
  return null;
}

export interface PitchTrial {
  trialIndex: number;
  velocityMph: number | null;
  lookup: TrialLookup;
}

/** Subset of f_pitching_force_metrics the framework reads (per trial). */
export interface ForceTrial {
  leadPeakVerticalBw: number | null;
  leadPeakBrakingBw: number | null;
  leadPeakVerticalPctFcBr: number | null;
  leadPeakBrakingPctFcBr: number | null;
  peaksSynced: boolean | null;
  peaksBeforeMer: boolean | null;
  drivePeakVerticalBw: number | null;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function avg(vals: Array<number | null | undefined>): number | null {
  const xs = vals.filter((v): v is number => v != null && Number.isFinite(v));
  return xs.length ? mean(xs) : null;
}
function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
const sub = (a: number | null, b: number | null) => (a != null && b != null ? a - b : null);
const div = (a: number | null, b: number | null) => (a != null && b != null && b !== 0 ? a / b : null);

export type ErFsFlag = "extreme_late" | "late" | "middle" | "arm_early";
export type ChainVerdict = "clean_chain" | "broken_sequence" | "slow_trunk_catch" | "weak_amplification" | "high_amplification";

export interface EightCylMetrics {
  velocity: { mean: number | null; sd: number; min: number | null; max: number | null; count: number; throws: Array<{ trial: number; velocity: number | null }> };
  cyl1: {
    stridePctHeight: number | null;
    strideLengthM: number | null;
    backLegGrfMax: number | null;
    backKneeFs: number | null;
    backKneeMer: number | null;
    deltaBackKneeFsToMer: number | null;
    pelvisLinYMph: number | null;
    trunkLinYMph: number | null;
  };
  cyl2: { hssFs: number | null; hssMer: number | null; hssRelease: number | null };
  cyl3: {
    thoraxPeak: number | null;
    pelvisPeak: number | null;
    ampPelvisToThorax: number | null;
    chainGainPct: number | null;
    chainLagMs: number | null;
    chainVerdict: ChainVerdict | null;
  };
  cyl4: {
    leadKneeFs: number | null;
    leadKneeRelease: number | null;
    leadKneeExtension: number | null;
    /** Lead GRF_BW@Release_Z when the export carries it; else null. */
    leadVertGrfRelease: number | null;
    /** f_pitching_force_metrics (force-plate layer). */
    leadPeakVerticalBw: number | null;
    leadPeakBrakingBw: number | null;
    peaksSyncedPct: number | null;
    peaksBeforeMerPct: number | null;
    leadPeakVerticalPctFcBr: number | null;
  };
  cyl5: {
    obliquityFs: number | null;
    obliquityMer: number | null;
    obliquityRelease: number | null;
    obliquityPeakAbs: number | null;
    obliquitySwing: number | null;
    stabilityFlag: "stable" | "watch" | "unstable" | null;
  };
  cyl6: {
    hzAbdFs: number | null;
    hzAbdMer: number | null;
    hzAbdRelease: number | null;
    dwellMs: number | null;
    progression: Array<{ ms: number; value: number | null }>;
  };
  cyl7: {
    erFs: number | null;
    erFsFlag: ErFsFlag | null;
    mer: number | null;
    elbowTorqueMerNm: number | null;
    stressPerMph: number | null;
    shoulderDistractionBw: number | null;
  };
  cyl8: {
    forwardFlexRelease: number | null;
    lateralTiltRelease: number | null;
    forwardFlexFs: number | null;
    lateralTiltFs: number | null;
    deltaForwardFlex: number | null;
    sagittalTrunkVelMph: number | null;
  };
  chain: {
    pelvisPeak: number | null;
    thoraxPeak: number | null;
    humerusPeak: number | null;
    handPeak: number | null;
    ampThoraxToHumerus: number | null;
    ampHumerusToHand: number | null;
    pelvisPeakRelFsMs: number | null;
    thoraxPeakRelFsMs: number | null;
    humerusPeakRelFsMs: number | null;
    handPeakRelFsMs: number | null;
  };
  pelvis: {
    angVelFs: number | null;
    angVelMer: number | null;
    angVelRelease: number | null;
    stopAfterFsMs: number | null;
    angleMer: number | null;
    angleStop: number | null;
    overshoot: "stable" | "mild" | "heavy" | null;
    recoil: "stable" | "moderate" | "hard" | null;
  };
  releasePhase: {
    pronationOffsetMs: number | null;
    pronationFlag: "clean" | "cut_risk" | "run_bias" | null;
    pctIrBeforeRelease: number | null;
    irFlag: "clean" | "borderline" | "cut_risk" | null;
    tiltModifier: "amplified_cut" | "amplified_ride" | "amplified_run" | "neutral" | null;
  };
  hasForcePlate: boolean;
}

export function erFsFlag(v: number | null): ErFsFlag | null {
  if (v == null) return null;
  if (v < 10) return "extreme_late";
  if (v < 33) return "late";
  if (v <= 80) return "middle";
  return "arm_early";
}

export function chainVerdict(gain: number | null, lag: number | null): ChainVerdict | null {
  if (gain == null || lag == null) return null;
  if (lag < 10) return "broken_sequence";
  if (lag > 120) return "slow_trunk_catch";
  if (gain < 20) return "weak_amplification";
  if (gain > 90) return "high_amplification";
  return "clean_chain";
}

const DWELL_STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];

export function extractEightCylinders(trials: PitchTrial[], force: ForceTrial[]): EightCylMetrics {
  const a = (id: string) => avg(trials.map((t) => t.lookup.get(id)));
  const velos = trials.map((t) => t.velocityMph).filter((v): v is number => v != null && Number.isFinite(v));
  const velocity = {
    mean: velos.length ? mean(velos) : null,
    sd: sd(velos),
    min: velos.length ? Math.min(...velos) : null,
    max: velos.length ? Math.max(...velos) : null,
    count: velos.length,
    throws: trials.map((t) => ({ trial: t.trialIndex, velocity: t.velocityMph })),
  };

  // Cyl 1 — Down-the-Mound Engine
  const bkFs = a("Back_Knee_Angle@Footstrike_X");
  const bkMer = a("Back_Knee_Angle@Max_Shoulder_Rot_X");
  const trunkLinY = a("MaxTrunkLinearVel_MPH_Y");
  const cyl1 = {
    stridePctHeight: a("STRIDE_LENGTH_MEAN_PERCENT"),
    strideLengthM: a("STRIDE_LENGTH"),
    backLegGrfMax: a("Back_Leg_GRF_mag_max"),
    backKneeFs: bkFs,
    backKneeMer: bkMer,
    deltaBackKneeFsToMer: sub(bkMer, bkFs),
    pelvisLinYMph: a("MaxPelvisLinearVel_MPH_Y"),
    trunkLinYMph: trunkLinY,
  };

  // Cyl 2 — Hip–shoulder separation
  const cyl2 = {
    hssFs: a("Trunk Rot wrt Pelvis Rot@Footstrike"),
    hssMer: a("Trunk Rot wrt Pelvis Rot@Max_Shoulder_Rot"),
    hssRelease: a("Trunk Rot wrt Pelvis Rot@Release"),
  };

  // Chain / Cyl 3
  const pelvisPeak = a("Pelvis_Ang_Vel_max");
  const thoraxPeak = a("Thorax_Ang_Vel_max");
  const humerusPeak = a("Pitching_Humerus_Ang_Vel_max");
  const handPeak = a("Pitching_Hand_Ang_Vel_max");
  const fsTime = a("FootstrikeTime");
  const relTime = a("ReleaseTime");
  const rel = (id: string) => {
    const t = a(id);
    return t != null && fsTime != null ? (t - fsTime) * 1000 : null;
  };
  const pelvisRel = rel("MaxPelvisVelTime");
  const thoraxRel = rel("MaxThoraxVelTime");
  const chainGainPct = thoraxPeak != null && pelvisPeak ? ((thoraxPeak - pelvisPeak) / pelvisPeak) * 100 : null;
  const chainLagMs = sub(thoraxRel, pelvisRel);
  const cyl3 = {
    thoraxPeak,
    pelvisPeak,
    ampPelvisToThorax: div(thoraxPeak, pelvisPeak),
    chainGainPct,
    chainLagMs,
    chainVerdict: chainVerdict(chainGainPct, chainLagMs),
  };

  // Cyl 4 — Front leg block (+ force-plate layer)
  const kneeFs = a("Lead_Knee_Angle@Footstrike_X");
  const kneeRel = a("Lead_Knee_Angle@Release_X");
  const pctTrue = (xs: Array<boolean | null>) => {
    const known = xs.filter((x): x is boolean => x != null);
    return known.length ? (known.filter(Boolean).length / known.length) * 100 : null;
  };
  const cyl4 = {
    leadKneeFs: kneeFs,
    leadKneeRelease: kneeRel,
    leadKneeExtension: sub(kneeFs, kneeRel),
    leadVertGrfRelease: a("Lead GRF_BW@Release_Z"),
    leadPeakVerticalBw: avg(force.map((f) => f.leadPeakVerticalBw)),
    leadPeakBrakingBw: avg(force.map((f) => f.leadPeakBrakingBw)),
    peaksSyncedPct: pctTrue(force.map((f) => f.peaksSynced)),
    peaksBeforeMerPct: pctTrue(force.map((f) => f.peaksBeforeMer)),
    leadPeakVerticalPctFcBr: avg(force.map((f) => f.leadPeakVerticalPctFcBr)),
  };

  // Cyl 5 — Pelvis stability & obliquity (frontal plane, Y)
  const oFs = a("Pelvis_Angle@Footstrike_Y");
  const oMer = a("Pelvis_Angle@Max_Shoulder_Rot_Y");
  const oRel = a("Pelvis_Angle@Release_Y");
  const oVals = [oFs, oMer, oRel].filter((v): v is number => v != null);
  const oPeak = oVals.length ? Math.max(...oVals.map(Math.abs)) : null;
  const cyl5 = {
    obliquityFs: oFs,
    obliquityMer: oMer,
    obliquityRelease: oRel,
    obliquityPeakAbs: oPeak,
    obliquitySwing: sub(oRel, oFs),
    stabilityFlag: oPeak == null ? null : oPeak > 25 ? ("unstable" as const) : oPeak > 15 ? ("watch" as const) : ("stable" as const),
  };

  // Cyl 6 — Horizontal abduction / arm trail (X axis), dwell ≤ −20°
  const hzFs = a("Pitching_Shoulder_Angle@Footstrike_X");
  const progression = [{ ms: 0, value: hzFs }, ...DWELL_STEPS.map((ms) => ({ ms, value: a(`Pitching_Shoulder_Angle@Footstrike_${ms}ms_X`) }))];
  const haveProgression = progression.slice(1).some((p) => p.value != null);
  let dwell = 0;
  for (const p of progression.slice(1)) if (p.value != null && p.value <= -20) dwell = p.ms;
  const cyl6 = {
    hzAbdFs: hzFs,
    hzAbdMer: a("Pitching_Shoulder_Angle@Max_Shoulder_Rot_X"),
    hzAbdRelease: a("Pitching_Shoulder_Angle@Release_X"),
    dwellMs: haveProgression ? dwell : null,
    progression,
  };

  // Cyl 7 — Arm health
  const erFs = a("Pitching_Shoulder_Angle@Footstrike_Z");
  const torque = a("Elbow_Torque_Nm@Max_Shoulder_Rot");
  const cyl7 = {
    erFs,
    erFsFlag: erFsFlag(erFs),
    mer: a("Pitching_Shoulder_Angle@Max_Shoulder_Rot_Z"),
    elbowTorqueMerNm: torque,
    stressPerMph: div(torque, velocity.mean),
    shoulderDistractionBw: a("Shoulder_Force_Abd@Max_Shoulder_Abd_Force"),
  };

  // Cyl 8 — Posture at release
  const ffRel = a("Trunk_Angle@Release_X");
  const ltRel = a("Trunk_Angle@Release_Y");
  const ffFs = a("Trunk_Angle@Footstrike_X");
  const ltFs = a("Trunk_Angle@Footstrike_Y");
  const cyl8 = {
    forwardFlexRelease: ffRel,
    lateralTiltRelease: ltRel,
    forwardFlexFs: ffFs,
    lateralTiltFs: ltFs,
    deltaForwardFlex: sub(ffRel, ffFs),
    sagittalTrunkVelMph: trunkLinY,
  };

  const chain = {
    pelvisPeak,
    thoraxPeak,
    humerusPeak,
    handPeak,
    ampThoraxToHumerus: div(humerusPeak, thoraxPeak),
    ampHumerusToHand: div(handPeak, humerusPeak),
    pelvisPeakRelFsMs: pelvisRel,
    thoraxPeakRelFsMs: thoraxRel,
    humerusPeakRelFsMs: rel("MaxHumerusVelTime"),
    handPeakRelFsMs: rel("MaxHandVelTime"),
  };

  // Pelvis decel / overshoot / recoil (Z = transverse rotation)
  const stopTime = a("PelvisRot_StopTime");
  const angStop = a("Pelvis_Angle@PelvisRot_Stop_Z");
  const avRel = a("Pelvis_Ang_Vel@Release_Z");
  const pelvis = {
    angVelFs: a("Pelvis_Ang_Vel@Footstrike_Z"),
    angVelMer: a("Pelvis_Ang_Vel@Max_Shoulder_Rot_Z"),
    angVelRelease: avRel,
    stopAfterFsMs: stopTime != null && fsTime != null ? (stopTime - fsTime) * 1000 : null,
    angleMer: a("Pelvis_Angle@Max_Shoulder_Rot_Z"),
    angleStop: angStop,
    overshoot: angStop == null ? null : angStop < -25 ? ("heavy" as const) : angStop < -10 ? ("mild" as const) : ("stable" as const),
    recoil: avRel == null ? null : avRel < -100 ? ("hard" as const) : avRel < -50 ? ("moderate" as const) : ("stable" as const),
  };

  // Release phase — cut/ride diagnostic (handedness-agnostic)
  const psupTime = a("Max_Forearm_PronSup_Ang_VelTime");
  const pronOffset = psupTime != null && relTime != null ? (psupTime - relTime) * 1000 : null;
  const merIr = cyl7.mer;
  const relIr = a("Pitching_Shoulder_Angle@Release_Z");
  const postIr = a("Pitching_Shoulder_Angle@Release100msAfter_Z");
  let pctIr: number | null = null;
  if (merIr != null && relIr != null && postIr != null) {
    const before = merIr - relIr;
    const after = relIr - postIr;
    if (before + after > 0) pctIr = Math.round((before / (before + after)) * 1000) / 10;
  }
  const tilt = ltRel;
  const tiltModifier =
    tilt == null
      ? null
      : tilt >= 45 && hzFs != null && hzFs <= -60
        ? ("amplified_cut" as const)
        : tilt >= 45 && hzFs != null && hzFs >= -20
          ? ("amplified_ride" as const)
          : tilt < 25 && erFs != null && erFs > 80
            ? ("amplified_run" as const)
            : ("neutral" as const);
  const releasePhase = {
    pronationOffsetMs: pronOffset,
    pronationFlag: pronOffset == null ? null : pronOffset < 0 ? ("run_bias" as const) : pronOffset > 60 ? ("cut_risk" as const) : ("clean" as const),
    pctIrBeforeRelease: pctIr,
    irFlag: pctIr == null ? null : pctIr > 55 ? ("cut_risk" as const) : pctIr > 50 ? ("borderline" as const) : ("clean" as const),
    tiltModifier,
  };

  return {
    velocity,
    cyl1,
    cyl2,
    cyl3,
    cyl4,
    cyl5,
    cyl6,
    cyl7,
    cyl8,
    chain,
    pelvis,
    releasePhase,
    hasForcePlate: force.some((f) => f.leadPeakVerticalBw != null),
  };
}
