/**
 * Swing-checkpoint extraction, ported from the hitting-swing-breakdown skill
 * (scripts/extract_swing_metrics.py) so the in-app Hitting report grades the
 * swing the same way the skill does.
 *
 * The skill reads the B_Young results.json time series. The warehouse keeps
 * Visual3D's per-swing scalars instead (f_hitting_trials.metrics, keys
 * "FOLDER.Variable" or "FOLDER.Variable.Component"), so each checkpoint is
 * computed from the value at the swing event (Pelvis_Angle@Lead_Foot_Down …)
 * and the TIMING folder's peak times. Where the skill needs a window search
 * that event scalars can't give, the closest event-based read is used and the
 * checkpoint says so (`basis`).
 *
 * Component handling: the R loader keeps the last component (Z) when a
 * variable has no ".X/.Y/.Z" suffix, which is the axial rotation the
 * checkpoints want. Knee flexion is the X component, so it comes from an
 * explicit ".X" key or the session-level f_kinematics_hitting value (which
 * keeps X), never from a bare trial key.
 *
 * Pure: no database access, so it can be tested on its own.
 */

import type { Status } from "@/lib/coach/biomech/framework";

export type Comp = "X" | "Y" | "Z";
export const MS2MPH = 2.2369363;

/** Swing events in order (Visual3D names as they appear after "@"). */
export const EVENTS = [
  "Setup",
  "MaxKneeHeight",
  "Lead_Foot_Off",
  "Downswing",
  "Lead_Foot_Down",
  "Max_Lead_Hand_Ang_Vel",
  "Max_Bat_Ang_Vel",
  "Contact",
] as const;
export const EVENT_LABEL: Record<string, string> = {
  Setup: "Setup",
  MaxKneeHeight: "Max knee height",
  Lead_Foot_Off: "Lead foot off",
  Downswing: "Downswing",
  Lead_Foot_Down: "Lead foot down",
  Max_Lead_Hand_Ang_Vel: "Peak hand speed",
  Max_Bat_Ang_Vel: "Peak bat speed",
  Contact: "Contact",
};
const EVENT_ALIASES: Record<string, string> = { SETUP: "Setup", Max_Knee_Height: "MaxKneeHeight", CONTACT: "Contact" };

function num(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** One swing's (or one session's) metrics, addressable by variable name + component. */
export class HitLookup {
  /** name → explicit components */
  private readonly comps = new Map<string, Partial<Record<Comp, number>>>();
  /** name → value of a key with no component suffix */
  private readonly bare = new Map<string, number>();
  readonly names = new Set<string>();

  constructor(metrics: Record<string, unknown>) {
    // PROCESSED wins when a variable appears in several folders.
    const entries = Object.entries(metrics ?? {}).sort(
      ([a], [b]) => Number(b.startsWith("PROCESSED.")) - Number(a.startsWith("PROCESSED.")),
    );
    for (const [key, raw] of entries) {
      const dot = key.indexOf(".");
      if (dot < 0) continue;
      let name = key.slice(dot + 1);
      let comp: Comp | null = null;
      const m = /^(.*)\.([XYZ])$/.exec(name);
      if (m) {
        name = m[1]!;
        comp = m[2] as Comp;
      }
      // AT_EVENT spells some events in caps (@SETUP, @CONTACT); PROCESSED uses @Setup / @Contact.
      name = name.replace(/_MEAN$/, "").replace(/@([A-Za-z_]+)$/, (_m, ev: string) => `@${EVENT_ALIASES[ev] ?? ev}`);
      this.names.add(name);
      if (comp) {
        const c = this.comps.get(name) ?? {};
        if (c[comp] == null) {
          const v = Array.isArray(raw) ? num(raw[0]) : num(raw);
          if (v != null) c[comp] = v;
        }
        this.comps.set(name, c);
        continue;
      }
      if (Array.isArray(raw)) {
        const vals = raw.map(num);
        const finite = vals.filter((v): v is number => v != null);
        // [x, y, z] when the loader kept all three components.
        if (raw.length === 3 && finite.length === 3) {
          const c = this.comps.get(name) ?? {};
          (["X", "Y", "Z"] as const).forEach((k, i) => { if (c[k] == null) c[k] = vals[i]!; });
          this.comps.set(name, c);
          continue;
        }
        if (finite.length && !this.bare.has(name)) this.bare.set(name, finite[0]!);
        continue;
      }
      const v = num(raw);
      if (v != null && !this.bare.has(name)) this.bare.set(name, v);
    }
  }

  /** Explicit component only. */
  comp(name: string, c: Comp): number | null {
    return this.comps.get(name)?.[c] ?? null;
  }

  /** Axial rotation / single-valued metric: explicit Z, else the bare value. */
  z(name: string): number | null {
    return this.comp(name, "Z") ?? this.bare.get(name) ?? null;
  }

  /** Single-valued metric (peaks, times, distances): bare, else X. */
  scalar(name: string): number | null {
    return this.bare.get(name) ?? this.comp(name, "X") ?? null;
  }

  /** Flexion-type signal (knee X): explicit X only — a bare key holds Z. */
  x(name: string): number | null {
    return this.comp(name, "X");
  }

  has(name: string): boolean {
    return this.names.has(name);
  }

  /** Events at which `${base}@<event>` exists, in swing order (unknown events last). */
  eventsFor(base: string): string[] {
    const found = new Set<string>();
    for (const n of this.names) {
      if (!n.startsWith(`${base}@`)) continue;
      const ev = n.slice(base.length + 1);
      found.add(ev);
    }
    const order = (e: string) => {
      const i = (EVENTS as readonly string[]).indexOf(e);
      return i < 0 ? 99 : i;
    };
    return [...found].sort((a, b) => order(a) - order(b));
  }
}

/** Session-level fallback (f_kinematics_hitting: frame 1 = X). */
export type SessionMeans = Map<string, number>;

export interface SwingTrial {
  trialIndex: number;
  lookup: HitLookup;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function avg(vals: Array<number | null | undefined>): number | null {
  const xs = vals.filter((v): v is number => v != null && Number.isFinite(v));
  return xs.length ? mean(xs) : null;
}
function sd(vals: Array<number | null | undefined>): number {
  const xs = vals.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}
const sub = (a: number | null, b: number | null) => (a != null && b != null ? a - b : null);

function tiltFromVertical(x: number | null, y: number | null): number | null {
  if (x == null || y == null) return null;
  const c = Math.max(-1, Math.min(1, Math.cos((x * Math.PI) / 180) * Math.cos((y * Math.PI) / 180)));
  return (Math.acos(c) * 180) / Math.PI;
}

export type SeqSeg = "pelvis" | "thorax" | "hand" | "bat";
export const SEQ_SEGS: SeqSeg[] = ["pelvis", "thorax", "hand", "bat"];
const SEQ_SIGNAL: Record<SeqSeg, { peak: string; time: string }> = {
  pelvis: { peak: "Max_Pelvis_Ang_Vel", time: "Max_Pelvis_Ang_VelTime" },
  thorax: { peak: "Max_Thorax_Ang_Vel", time: "Max_Thorax_Ang_VelTime" },
  hand: { peak: "Max_Lead_Hand_Ang_Vel", time: "Max_Lead_Hand_Ang_VelTime" },
  bat: { peak: "Max_Bat_Ang_Vel", time: "Max_Bat_Ang_VelTime" },
};

export interface SwingRead {
  trial: number;
  batSpeedMph: number | null;
  handSpeedMph: number | null;
  peaks: Record<SeqSeg, number | null>;
  /** Peak times (s) from the TIMING folder. */
  peakTimes: Record<SeqSeg, number | null>;
  order: SeqSeg[];
  proper: boolean | null;
  lfdTime: number | null;
  contactTime: number | null;
  downswingTime: number | null;
  /** Rotation was mirrored (pelvis negative at foot-down) and has been flipped. */
  flipped: boolean;
  pelvisZ: Record<string, number | null>;
  trunkZ: Record<string, number | null>;
  kneeFlexLfd: number | null;
  kneeFlexContact: number | null;
  kneeVelLfd: number | null;
  kneeVelContact: number | null;
  trunkTilt: Record<string, number | null>;
  pelvisTilt: Record<string, number | null>;
  /** Pelvis CG travel foot-down → contact (m, RPV_CGPos_VLab_zeroed; X toward pitcher, Y lateral, Z vertical). */
  pelvisMove: Record<Comp, number | null>;
  /** Pelvis CG at foot-down (m). The position is zeroed at lead-foot-off, so this is the stride travel. */
  pelvisAtLfd: Record<Comp, number | null>;
  /** Visual3D's per-swing max lead-knee extension (smallest X flexion, °). */
  kneeExtMaxAngle: number | null;
}

const TILT_EVENTS = ["Setup", "MaxKneeHeight", "Lead_Foot_Off", "Lead_Foot_Down", "Contact"];

function readSwing(t: SwingTrial, session: SessionMeans): SwingRead {
  const L = t.lookup;
  const at = (base: string, ev: string) => `${base}@${ev}`;
  const peaks = Object.fromEntries(SEQ_SEGS.map((s) => [s, L.scalar(SEQ_SIGNAL[s].peak)])) as Record<SeqSeg, number | null>;
  const peakTimes = Object.fromEntries(SEQ_SEGS.map((s) => [s, L.scalar(SEQ_SIGNAL[s].time)])) as Record<SeqSeg, number | null>;
  const timed = SEQ_SEGS.filter((s) => peakTimes[s] != null).sort((a, b) => peakTimes[a]! - peakTimes[b]!);
  const proper = timed.length === 4 ? timed.join() === SEQ_SEGS.join() : null;

  // Rotation Z at every event; mirrored captures (pelvis negative at foot-down) are flipped.
  const pz: Record<string, number | null> = {};
  const tz: Record<string, number | null> = {};
  for (const ev of EVENTS) {
    pz[ev] = L.z(at("Pelvis_Angle", ev));
    tz[ev] = L.z(at("Trunk_Angle", ev));
  }
  const flipped = (pz.Lead_Foot_Down ?? 0) < 0;
  if (flipped) {
    for (const ev of EVENTS) {
      if (pz[ev] != null) pz[ev] = -pz[ev]!;
      if (tz[ev] != null) tz[ev] = -tz[ev]!;
    }
  }

  // Per-swing knee X only. The session table's value is swing 1's, so extractSwing uses it
  // as a fallback for the whole session rather than copying it into every swing.
  void session;
  const kneeX = (ev: string) => L.x(at("Lead_Knee_Angle", ev));
  const kneeVelX = (ev: string) => L.x(at("Lead_Knee_Ang_Vel", ev));
  const cg = (c: Comp) => sub(L.comp(at("RPV_CGPos_VLab_zeroed", "Contact"), c), L.comp(at("RPV_CGPos_VLab_zeroed", "Lead_Foot_Down"), c));

  const trunkTilt: Record<string, number | null> = {};
  const pelvisTilt: Record<string, number | null> = {};
  for (const ev of TILT_EVENTS) {
    trunkTilt[ev] = tiltFromVertical(L.comp(at("Trunk_Angle", ev), "X"), L.comp(at("Trunk_Angle", ev), "Y"));
    pelvisTilt[ev] = tiltFromVertical(L.comp(at("Pelvis_Angle", ev), "X"), L.comp(at("Pelvis_Angle", ev), "Y"));
  }

  const bat = L.scalar("Max_Bat_Linear_Vel");
  const hand = L.scalar("Max_Lead_Hand_Linear_Vel");
  return {
    trial: t.trialIndex,
    batSpeedMph: bat != null ? bat * MS2MPH : null,
    handSpeedMph: hand != null ? hand * MS2MPH : null,
    peaks,
    peakTimes,
    order: timed,
    proper,
    lfdTime: L.scalar("Lead_Foot_DownTime"),
    contactTime: L.scalar("ContactTime"),
    downswingTime: L.scalar("DownswingTime"),
    flipped,
    pelvisZ: pz,
    trunkZ: tz,
    kneeFlexLfd: kneeX("Lead_Foot_Down"),
    kneeFlexContact: kneeX("Contact"),
    kneeVelLfd: kneeVelX("Lead_Foot_Down"),
    kneeVelContact: kneeVelX("Contact"),
    trunkTilt,
    pelvisTilt,
    pelvisMove: { X: cg("X"), Y: cg("Y"), Z: cg("Z") },
    pelvisAtLfd: {
      X: L.comp(at("RPV_CGPos_VLab_zeroed", "Lead_Foot_Down"), "X"),
      Y: L.comp(at("RPV_CGPos_VLab_zeroed", "Lead_Foot_Down"), "Y"),
      Z: L.comp(at("RPV_CGPos_VLab_zeroed", "Lead_Foot_Down"), "Z"),
    },
    kneeExtMaxAngle: L.scalar("Lead_Knee_Angle_ext_max"),
  };
}

export interface Checkpoint {
  id: string;
  label: string;
  valueText: string;
  target: string;
  status: Status;
  note: string;
  /** How it was measured when it differs from the skill (event-sampled proxy, etc.). */
  basis?: string;
}

export interface SequenceRead {
  peaks: Record<SeqSeg, number | null>;
  /** Mean ms from the pelvis peak. */
  lagMs: Record<SeqSeg, number | null>;
  /** Mean peak time as % of lead-foot-down → contact (0 = foot down, 100 = contact). */
  pctWindow: Record<SeqSeg, number | null>;
  properRate: number | null;
  timedSwings: number;
  modalOrder: SeqSeg[];
  ampPelvisThorax: number | null;
  ampThoraxHand: number | null;
  ampHandBat: number | null;
  amplifies: boolean;
  downswingBeforeLfdMs: number | null;
  lfdToContactMs: number | null;
}

export interface SwingMetrics {
  swings: SwingRead[];
  n: number;
  bat: { mean: number | null; sd: number; min: number | null; max: number | null };
  handSpeedMph: number | null;
  sequence: SequenceRead;
  rotation: {
    pelvis: Record<string, number | null>;
    trunk: Record<string, number | null>;
    xfactor: Record<string, number | null>;
    flippedSwings: number;
  };
  load: { pelvisCoil: number | null; trunkCoil: number | null; via: "MaxKneeHeight" | "Lead_Foot_Down" | null };
  trunkOpenBeforeLfd: number | null;
  knee: {
    flexLfd: number | null;
    flexContact: number | null;
    extension: number | null;
    velLfd: number | null;
    velContact: number | null;
    /** Visual3D's own stored max (different window than the checkpoint). */
    storedExtMax: number | null;
    /** "swings" = averaged per swing; "swing1" = session table, which holds the first swing only. */
    source: "swings" | "swing1" | null;
    /** Mean of Visual3D's per-swing max extension (smallest flexion, °) — stored for every swing. */
    extMaxAngle: number | null;
  };
  /**
   * Mean pelvis CG travel foot-down → contact (m), from swings that carry the position.
   * `forward` is along the stride axis (the lab axis the pelvis travels most from foot-off to
   * foot-down, signed so the stride is positive) — the skill assumes X, but lab frames differ.
   */
  pelvisMove: { forward: number | null; lateral: number | null; vertical: number | null; forwardAxis: "X" | "Y" | null; swings: number };
  tilt: {
    trunk: Record<string, number | null>;
    pelvis: Record<string, number | null>;
    available: boolean;
    ok: boolean;
    messages: string[];
  };
  bat3d: {
    verticalAttack: number | null;
    horizontalAttack: number | null;
    frontal: number | null;
    sagittal: number | null;
    transversal: number | null;
    travelled: number | null;
  };
  checkpoints: Checkpoint[];
}

const fmt0 = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v.toFixed(0) : "—");
const sgn0 = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}`;

function contactStatus(v: number): Status {
  if (v >= 0 && v <= 15) return "best";
  if ((v >= -15 && v < 0) || (v > 15 && v <= 25)) return "warn";
  return "bad";
}

export function extractSwing(trials: SwingTrial[], session: SessionMeans = new Map()): SwingMetrics {
  const swings = trials.map((t) => readSwing(t, session));
  const col = <T,>(f: (s: SwingRead) => T) => swings.map(f);

  const batVals = col((s) => s.batSpeedMph).filter((v): v is number => v != null);
  const peaks = Object.fromEntries(SEQ_SEGS.map((k) => [k, avg(col((s) => s.peaks[k]))])) as Record<SeqSeg, number | null>;

  // Timing: per swing, lag from the pelvis peak and % of the foot-down → contact window.
  const lagMs = Object.fromEntries(SEQ_SEGS.map((k) => [k, avg(col((s) => (s.peakTimes[k] != null && s.peakTimes.pelvis != null ? (s.peakTimes[k]! - s.peakTimes.pelvis!) * 1000 : null)))])) as Record<SeqSeg, number | null>;
  const pctWindow = Object.fromEntries(SEQ_SEGS.map((k) => [k, avg(col((s) => {
    const t = s.peakTimes[k];
    if (t == null || s.lfdTime == null || s.contactTime == null || s.contactTime <= s.lfdTime) return null;
    return ((t - s.lfdTime) / (s.contactTime - s.lfdTime)) * 100;
  }))])) as Record<SeqSeg, number | null>;
  const timed = swings.filter((s) => s.proper != null);
  const properRate = timed.length ? timed.filter((s) => s.proper).length / timed.length : null;
  const orders = new Map<string, number>();
  for (const s of swings) if (s.order.length) orders.set(s.order.join(), (orders.get(s.order.join()) ?? 0) + 1);
  const modal = [...orders.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const ratio = (a: number | null, b: number | null) => (a != null && b != null && a > 0 ? b / a : null);
  const amplifies = SEQ_SEGS.every((k) => peaks[k] != null) && peaks.pelvis! < peaks.thorax! && peaks.thorax! < peaks.hand! && peaks.hand! < peaks.bat!;

  const sequence: SequenceRead = {
    peaks,
    lagMs,
    pctWindow,
    properRate,
    timedSwings: timed.length,
    modalOrder: modal ? (modal.split(",") as SeqSeg[]) : [],
    ampPelvisThorax: ratio(peaks.pelvis, peaks.thorax),
    ampThoraxHand: ratio(peaks.thorax, peaks.hand),
    ampHandBat: ratio(peaks.hand, peaks.bat),
    amplifies,
    downswingBeforeLfdMs: avg(col((s) => (s.lfdTime != null && s.downswingTime != null ? (s.lfdTime - s.downswingTime) * 1000 : null))),
    lfdToContactMs: avg(col((s) => (s.lfdTime != null && s.contactTime != null ? (s.contactTime - s.lfdTime) * 1000 : null))),
  };

  const pelvis: Record<string, number | null> = {};
  const trunk: Record<string, number | null> = {};
  const xfactor: Record<string, number | null> = {};
  for (const ev of EVENTS) {
    pelvis[ev] = avg(col((s) => s.pelvisZ[ev]));
    trunk[ev] = avg(col((s) => s.trunkZ[ev]));
    xfactor[ev] = avg(col((s) => sub(s.trunkZ[ev] ?? null, s.pelvisZ[ev] ?? null)));
  }

  // CP2 load: setup → max knee height per the skill; foot-down when the export has no max-knee-height event.
  const coilVia: "MaxKneeHeight" | "Lead_Foot_Down" | null = pelvis.MaxKneeHeight != null && trunk.MaxKneeHeight != null
    ? "MaxKneeHeight" : trunk.Lead_Foot_Down != null ? "Lead_Foot_Down" : null;
  const pelvisCoil = coilVia === "MaxKneeHeight" ? avg(col((s) => sub(s.pelvisZ.MaxKneeHeight ?? null, s.pelvisZ.Setup ?? null))) : null;
  const trunkCoil = coilVia ? avg(col((s) => sub(s.trunkZ[coilVia] ?? null, s.trunkZ.Setup ?? null))) : null;

  // CP3: most-closed trunk before foot-down minus trunk at foot-down, from the events the export has.
  const trunkOpenBeforeLfd = avg(col((s) => {
    const lfd = s.trunkZ.Lead_Foot_Down;
    if (lfd == null) return null;
    const before = ["Setup", "MaxKneeHeight", "Lead_Foot_Off", "Lead_Foot_Down"].map((e) => s.trunkZ[e]).filter((v): v is number => v != null);
    return Math.max(...before) - lfd;
  }));

  let flexLfd = avg(col((s) => s.kneeFlexLfd));
  let flexContact = avg(col((s) => s.kneeFlexContact));
  let velLfd = avg(col((s) => s.kneeVelLfd));
  let velContact = avg(col((s) => s.kneeVelContact));
  let kneeSource: "swings" | "swing1" | null = flexLfd != null || flexContact != null ? "swings" : null;
  if (kneeSource == null) {
    flexLfd = session.get("Lead_Knee_Angle@Lead_Foot_Down") ?? null;
    flexContact = session.get("Lead_Knee_Angle@Contact") ?? null;
    velLfd = velLfd ?? session.get("Lead_Knee_Ang_Vel@Lead_Foot_Down") ?? null;
    velContact = velContact ?? session.get("Lead_Knee_Ang_Vel@Contact") ?? null;
    if (flexLfd != null || flexContact != null) kneeSource = "swing1";
  }
  const moved = swings.filter((s) => s.pelvisMove.X != null || s.pelvisMove.Y != null || s.pelvisMove.Z != null);
  const strideX = avg(moved.map((s) => s.pelvisAtLfd.X));
  const strideY = avg(moved.map((s) => s.pelvisAtLfd.Y));
  const fwdAxis: "X" | "Y" | null = !moved.length ? null : strideY != null && strideX != null && Math.abs(strideY) > Math.abs(strideX) ? "Y" : "X";
  const latAxis: "X" | "Y" = fwdAxis === "Y" ? "X" : "Y";
  const fwdSign = (fwdAxis === "Y" ? strideY : strideX) ?? 1;
  const moveFwd = fwdAxis ? avg(moved.map((s) => s.pelvisMove[fwdAxis])) : null;
  // Visual3D's stored value flips sign between swings; the size is what matters.
  const absOrNull = (v: number | null | undefined) => (v != null ? Math.abs(v) : null);
  const storedExtMax = avg(trials.map((t) => absOrNull(t.lookup.scalar("Lead_Knee_Ang_Vel_ext_max")))) ?? absOrNull(session.get("Lead_Knee_Ang_Vel_ext_max")) ?? null;

  const trunkTilt = Object.fromEntries(TILT_EVENTS.map((e) => [e, avg(col((s) => s.trunkTilt[e]))]));
  const pelvisTilt = Object.fromEntries(TILT_EVENTS.map((e) => [e, avg(col((s) => s.pelvisTilt[e]))]));
  const tiltAvailable = Object.values(trunkTilt).some((v) => v != null);
  const msgs: string[] = [];
  const st = trunkTilt.Setup ?? null;
  const setupOk = st != null && st >= 8 && st <= 30;
  const axialOk = trunk.Lead_Foot_Down != null && pelvis.Lead_Foot_Down != null
    && Math.abs(trunk.Lead_Foot_Down) >= 60 && Math.abs(trunk.Lead_Foot_Down) <= 135 && Math.abs(pelvis.Lead_Foot_Down) >= 60 && Math.abs(pelvis.Lead_Foot_Down) <= 135;
  if (tiltAvailable) {
    if (!setupOk) msgs.push(`Setup trunk tilt ${st != null ? st.toFixed(0) : "—"}° is outside 8–30°, so the frame/axis assumption may not hold. Treat the tilt numbers as unconfirmed.`);
    else if (st! < 12 || st! > 22) msgs.push(`Setup trunk tilt ${st!.toFixed(0)}° is outside the typical 12–22° stance band. Usable, but note it.`);
    if (!axialOk) msgs.push("Axial rotation at foot-down isn't in the expected ~80–120° band; the capture frame may differ from the reference.");
  }

  const bat3d = {
    verticalAttack: avg(trials.map((t) => t.lookup.scalar("Vertical_attack_angle"))),
    horizontalAttack: avg(trials.map((t) => t.lookup.scalar("Horizontal_attack_angle"))),
    frontal: avg(trials.map((t) => t.lookup.scalar("Bat_Angle_Frontal@Contact"))),
    sagittal: avg(trials.map((t) => t.lookup.scalar("Bat_Angle_Sagittal@Contact"))),
    transversal: avg(trials.map((t) => t.lookup.scalar("Bat_Angle_Transversal@Contact"))),
    travelled: avg(trials.map((t) => t.lookup.scalar("Bat_travelled_distance_max"))),
  };

  const m: SwingMetrics = {
    swings,
    n: swings.length,
    bat: { mean: batVals.length ? mean(batVals) : null, sd: sd(batVals), min: batVals.length ? Math.min(...batVals) : null, max: batVals.length ? Math.max(...batVals) : null },
    handSpeedMph: avg(col((s) => s.handSpeedMph)),
    sequence,
    rotation: { pelvis, trunk, xfactor, flippedSwings: swings.filter((s) => s.flipped).length },
    load: { pelvisCoil, trunkCoil, via: coilVia },
    trunkOpenBeforeLfd,
    knee: {
      flexLfd,
      flexContact,
      extension: sub(flexLfd, flexContact),
      velLfd,
      velContact,
      storedExtMax,
      source: kneeSource,
      extMaxAngle: avg(col((s) => s.kneeExtMaxAngle)),
    },
    pelvisMove: {
      forward: moveFwd != null ? moveFwd * (fwdSign < 0 ? -1 : 1) : null,
      lateral: avg(moved.map((s) => s.pelvisMove[latAxis])),
      vertical: avg(moved.map((s) => s.pelvisMove.Z)),
      forwardAxis: fwdAxis,
      swings: moved.length,
    },
    tilt: { trunk: trunkTilt, pelvis: pelvisTilt, available: tiltAvailable, ok: tiltAvailable && setupOk && axialOk, messages: msgs },
    bat3d,
    checkpoints: [],
  };
  m.checkpoints = grade(m);
  return m;
}

/** CP1–CP8 with the skill's thresholds (references/checkpoints.md). */
export function grade(m: SwingMetrics): Checkpoint[] {
  const out: Checkpoint[] = [];
  const s = m.sequence;
  const p = s.peaks;

  if (SEQ_SEGS.some((k) => p[k] != null)) {
    const rate = s.properRate;
    out.push({
      id: "CP1",
      label: "Kinematic sequence",
      valueText: `${fmt0(p.pelvis)} → ${fmt0(p.thorax)} → ${fmt0(p.hand)} → ${fmt0(p.bat)} °/s`,
      target: "peaks build pelvis → thorax → hand → bat, firing in that order",
      status: s.amplifies && (rate ?? 0) >= 0.75 ? "best" : s.amplifies ? "good" : "warn",
      note: `Peak speeds ${s.amplifies ? "amplify properly" : "do not build cleanly"} out to the bat${rate != null ? `; timing fired in order on ${Math.round(rate * 100)}% of swings` : ""}.`,
      basis: rate == null ? "Peak magnitudes only — the export has no peak times for these swings." : undefined,
    });
  }

  const { pelvisCoil, trunkCoil, via } = m.load;
  if (via === "MaxKneeHeight" && pelvisCoil != null && trunkCoil != null) {
    const good = pelvisCoil >= 5 && trunkCoil >= 5;
    out.push({
      id: "CP2",
      label: "Load / coil into back hip",
      valueText: `pelvis ${sgn0(pelvisCoil)}°, trunk ${sgn0(trunkCoil)}° (setup → max knee height)`,
      target: "both rotate more closed (≥ +5° each)",
      status: good ? "best" : pelvisCoil > 0 && trunkCoil > 0 ? "warn" : "bad",
      note: "Pelvis and trunk should counter-rotate into the back hip during the leg lift; positive = coiling closed.",
    });
  } else if (via === "Lead_Foot_Down" && trunkCoil != null) {
    out.push({
      id: "CP2",
      label: "Load / coil (trunk)",
      valueText: `trunk ${sgn0(trunkCoil)}° (setup → foot-down)`,
      target: "trunk stays or gets more closed (≥ +5°)",
      status: trunkCoil >= 5 ? "best" : trunkCoil > 0 ? "warn" : "bad",
      note: "The upper half should gather closed through the stride; positive = coiling closed.",
      basis: "No max-knee-height event in this export, so the trunk is read from setup to foot-down and the pelvis (which should already be opening by then) isn't graded.",
    });
  }

  if (m.trunkOpenBeforeLfd != null) {
    const v = m.trunkOpenBeforeLfd;
    out.push({
      id: "CP3",
      label: "Trunk stays closed to foot-down",
      valueText: `opens ${v.toFixed(1)}° before lead foot down`,
      target: "≤ 3° of trunk opening before foot-down",
      status: v <= 3 ? "best" : v <= 6 ? "warn" : "bad",
      note: "The trunk should hold its coil until the front foot plants.",
      basis: m.rotation.trunk.MaxKneeHeight == null ? "Read from the swing events in the export (setup and foot-down), not a frame-by-frame search." : undefined,
    });
  }

  const pzL = m.rotation.pelvis.Lead_Foot_Down;
  if (pzL != null) {
    out.push({
      id: "CP4",
      label: "Pelvis open by foot-down",
      valueText: `${pzL.toFixed(0)}° at lead foot down`,
      target: "≤ 90° (pelvis already firing open)",
      status: pzL <= 90 ? "best" : pzL <= 95 ? "warn" : "bad",
      note: "Lower = more open; the pelvis should be starting to clear at plant.",
    });
  }

  const xf = m.rotation.xfactor.Lead_Foot_Down;
  if (xf != null) {
    out.push({
      id: "CP5",
      label: "Hip-shoulder separation (X-factor)",
      valueText: `${xf > 29 && xf < 30 ? xf.toFixed(1) : xf.toFixed(0)}° at lead foot down`,
      target: "≥ 30° (shoulders closed on an opening pelvis)",
      status: xf >= 30 ? "best" : xf >= 20 ? "warn" : "bad",
      note: "Trunk minus pelvis rotation; the stretch that powers the swing.",
    });
  }

  const pzC = m.rotation.pelvis.Contact;
  const tzC = m.rotation.trunk.Contact;
  if (pzC != null) {
    out.push({ id: "CP6a", label: "Pelvis not over-rotated @ contact", valueText: `${sgn0(pzC)}°`, target: "0° to +15° (square, slightly closed); not negative", status: contactStatus(pzC), note: "Negative = rotated past square (spinning off)." });
  }
  if (tzC != null) {
    out.push({ id: "CP6b", label: "Trunk not over-rotated @ contact", valueText: `${sgn0(tzC)}°`, target: "0° to +15° (square, slightly closed); not negative", status: contactStatus(tzC), note: "Negative = trunk rotated past square at contact." });
  }

  const k = m.knee;
  if (k.flexLfd != null && k.flexContact != null) {
    const goodStart = k.flexLfd >= 40 && k.flexLfd <= 50;
    const goodEnd = k.flexContact <= 12;
    out.push({
      id: "CP7a",
      label: "Lead-leg post (knee extension)",
      valueText: `${k.flexLfd.toFixed(0)}° → ${k.flexContact.toFixed(0)}° (foot-down → contact)`,
      target: "~45° (±5) → as close to 0° as possible",
      status: goodStart && goodEnd && k.flexContact <= 8 ? "best" : goodEnd ? "good" : "warn",
      note: "The front knee should straighten to brace and create the rotational axis.",
      basis: k.source === "swing1" ? "Knee flexion comes from the session table, which holds the first swing only; the per-swing values aren't stored for this session." : undefined,
    });
  }
  if (k.velLfd != null || k.velContact != null || k.storedExtMax != null) {
    // The window peak is at least the larger of the two event samples, so ≥ 100 there is a pass.
    const floor = Math.max(...[k.velLfd, k.velContact].filter((v): v is number => v != null).map(Math.abs), -1);
    const passes = floor >= 100;
    const parts = [
      k.velLfd != null ? `${Math.abs(k.velLfd).toFixed(0)} °/s at foot-down` : null,
      k.velContact != null ? `${Math.abs(k.velContact).toFixed(0)} °/s at contact` : null,
      k.storedExtMax != null ? `stored max ${k.storedExtMax.toFixed(0)} °/s` : null,
    ].filter(Boolean);
    out.push({
      id: "CP7b",
      label: "Knee extension speed",
      valueText: parts.join(" · "),
      target: "≥ 100 °/s peak through contact",
      status: passes ? "best" : "neutral",
      note: "How fast the front knee is straightening into the swing.",
      basis: passes
        ? "Graded on the event samples: the peak between foot-down and contact is at least the larger of the two, which already clears 100 °/s."
        : "The checkpoint needs the peak between foot-down and contact, which the warehouse doesn't store frame by frame, and the event samples alone don't clear 100 °/s. Shown for reference, not graded.",
    });
  }

  const pm = m.pelvisMove;
  if (pm.forward != null || pm.vertical != null) {
    const parts = [
      pm.forward != null ? `${sgn0(pm.forward * 100)} cm toward pitcher` : null,
      pm.vertical != null ? `${sgn0(pm.vertical * 100)} cm vertical` : null,
    ].filter(Boolean);
    const basis = [
      pm.forwardAxis === "Y" ? "This lab's stride runs along Y, so \"toward pitcher\" is read on Y (the skill's reference lab uses X)." : null,
      pm.swings < m.n ? `From the ${pm.swings} of ${m.n} swings that carry the pelvis position.` : null,
    ].filter(Boolean).join(" ");
    out.push({
      id: "CP8",
      label: "Pelvis linear move (foot-down → contact)",
      valueText: parts.join(", "),
      target: "reference marker (no pass/fail)",
      status: "neutral",
      note: "Centre-mass travel from plant to contact: going forward to meet the ball, and settling into the post.",
      basis: basis || undefined,
    });
  } else {
    out.push({
      id: "CP8",
      label: "Pelvis linear move (foot-down → contact)",
      valueText: "not stored for this session",
      target: "reference marker (no pass/fail)",
      status: "neutral",
      note: "Centre-mass travel from plant to contact needs the pelvis CG position at foot-down and contact (newer captures carry it).",
    });
  }
  return out;
}
