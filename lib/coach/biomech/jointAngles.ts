/**
 * Visual3D joint angles rebuilt from the stored per-frame segment orientations
 * (f_pitching_segment_rot_data: one [x, y, z] Euler triple per segment per frame), so they can be
 * read at any frame — e.g. 10 ms after release, which the V3D export doesn't have.
 *
 * How V3D's numbers come out of the stored triples (found by search; reproduces V3D to < 0.0001 deg
 * at foot contact, MER, release and +100 ms on right-handed sample captures):
 * - Segment orientation R = Rx(x) · Ry(y) · Rz(z) (intrinsic X-Y-Z).
 * - Pitching_Hand_Angle      = XYZ(R_forearm^T · R_hand)      · (+1, -1, +1)
 * - Pitching_Elbow_Angle     = XYZ(R_arm^T · R_forearm)       · (+1, +1, -1)
 * - Pitching_Shoulder_Angle  = zyz(R_arm^T · R_thorax)        · (-1, +1, +1)   (extrinsic z-y-z, V3D's "globe" order)
 * - Trunk_wrt_Pelvis_FE      = XYZ(R_pelvis^T · R_thorax)     · (-1, -1, -1)
 * - Pelvis_Angle / Trunk_Angle = the stored triple of Pelvis / Thorax · (-1, -1, -1)
 *
 * Left-handers: V3D mirrors them, so the signs differ. Rather than hard-code a guess, each trial is
 * calibrated: every mirror (sign pattern on the stored triples) × output sign pattern is tried
 * against V3D's own values at foot contact, MER and release, and the one that reproduces them is
 * used. A trial whose best fit is off by more than MATCH_TOL_DEG gets no computed values.
 */

export type V3 = [number, number, number];
type M3 = [V3, V3, V3]; // rows

export type JointId = "Pitching_Hand_Angle" | "Pitching_Elbow_Angle" | "Pitching_Shoulder_Angle" | "Trunk_wrt_Pelvis_FE" | "Pelvis_Angle" | "Trunk_Angle";

/** Above this (deg, worst component across the calibration events) a trial isn't trusted. */
export const MATCH_TOL_DEG = 0.5;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function rx(a: number): M3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}
function ry(a: number): M3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}
function rz(a: number): M3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}
function mul(a: M3, b: M3): M3 {
  const o = [[0, 0, 0], [0, 0, 0], [0, 0, 0]] as M3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i]![j] = a[i]![0] * b[0]![j] + a[i]![1] * b[1]![j] + a[i]![2] * b[2]![j];
  return o;
}
const tr = (a: M3): M3 => [[a[0][0], a[1][0], a[2][0]], [a[0][1], a[1][1], a[2][1]], [a[0][2], a[1][2], a[2][2]]];
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** Segment orientation from a stored triple (deg), intrinsic X-Y-Z. */
export function segR(t: V3): M3 {
  return mul(mul(rx(t[0] * D2R), ry(t[1] * D2R)), rz(t[2] * D2R));
}

/** Intrinsic X-Y-Z angles (deg) of R = Rx·Ry·Rz. */
export function xyz(R: M3): V3 {
  const b = Math.asin(clamp1(R[0][2]));
  const a = Math.atan2(-R[1][2], R[2][2]);
  const c = Math.atan2(-R[0][1], R[0][0]);
  return [a * R2D, b * R2D, c * R2D];
}

/** Extrinsic z-y-z angles (deg): R = Rz(g) · Ry(b) · Rz(a) → [a, b, g] (b in [0, 180]). */
export function zyzExtrinsic(R: M3): V3 {
  const b = Math.acos(clamp1(R[2][2]));
  if (Math.abs(Math.sin(b)) < 1e-9) {
    // Gimbal: only a + g is defined.
    return [Math.atan2(R[1][0], R[0][0]) * R2D, b * R2D, 0];
  }
  const g = Math.atan2(R[1][2], R[0][2]);
  const a = Math.atan2(R[2][1], -R[2][0]);
  return [a * R2D, b * R2D, g * R2D];
}

const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Segment names per joint for one throwing side (proximal, distal); null proximal = the segment itself. */
export function jointSegments(side: "R" | "L"): Record<JointId, [string | null, string]> {
  return {
    Pitching_Hand_Angle: [`${side}Forearm`, `${side}Hand`],
    Pitching_Elbow_Angle: [`${side}Arm`, `${side}Forearm`],
    Pitching_Shoulder_Angle: [`${side}Arm`, "Thorax"], // note: arm^T · thorax
    Trunk_wrt_Pelvis_FE: ["Pelvis", "Thorax"],
    Pelvis_Angle: [null, "Pelvis"],
    Trunk_Angle: [null, "Thorax"],
  };
}

const RH_OUT: Record<JointId, V3> = {
  Pitching_Hand_Angle: [1, -1, 1],
  Pitching_Elbow_Angle: [1, 1, -1],
  Pitching_Shoulder_Angle: [-1, 1, 1],
  Trunk_wrt_Pelvis_FE: [-1, -1, -1],
  Pelvis_Angle: [-1, -1, -1],
  Trunk_Angle: [-1, -1, -1],
};

/** Sign patterns tried during calibration: mirror on the stored triples × sign on the output. */
const SIGNS: V3[] = [];
for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) SIGNS.push([x, y, z]);

export interface JointConvention {
  /** Applied to each stored triple before building the segment orientation (a mirror). */
  inSign: V3;
  /** Applied to the decomposed angles. */
  outSign: V3;
}

/** Raw (unsigned) joint angles from one frame's stored triples. */
function rawAngles(joint: JointId, prox: V3 | null, dist: V3, inSign: V3): V3 {
  const s = (t: V3): V3 => [t[0] * inSign[0], t[1] * inSign[1], t[2] * inSign[2]];
  if (prox == null) return s(dist);
  const P = segR(s(prox));
  const C = segR(s(dist));
  return joint === "Pitching_Shoulder_Angle" ? zyzExtrinsic(mul(tr(P), C)) : xyz(mul(tr(P), C));
}

export function jointAngles(joint: JointId, prox: V3 | null, dist: V3, conv: JointConvention): V3 {
  const r = rawAngles(joint, prox, dist, conv.inSign);
  return [r[0] * conv.outSign[0], r[1] * conv.outSign[1], r[2] * conv.outSign[2]];
}

/** A calibration sample: the stored triples at an event frame and V3D's angle there. */
export interface CalSample {
  prox: V3 | null;
  dist: V3;
  v3d: V3;
}

/**
 * Pick the convention that reproduces V3D at the calibration samples. Tries the right-hand default
 * first; otherwise every in/out sign pair. Returns the convention and its worst error (deg), or null
 * without samples.
 */
export function calibrate(joint: JointId, samples: CalSample[]): { conv: JointConvention; errDeg: number } | null {
  if (!samples.length) return null;
  const err = (conv: JointConvention) => {
    let worst = 0;
    for (const s of samples) {
      const a = jointAngles(joint, s.prox, s.dist, conv);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(wrap(a[k]! - s.v3d[k]!)));
    }
    return worst;
  };
  const rh: JointConvention = { inSign: [1, 1, 1], outSign: RH_OUT[joint] };
  let best = { conv: rh, errDeg: err(rh) };
  if (best.errDeg <= MATCH_TOL_DEG) return best;
  for (const inSign of SIGNS) {
    for (const outSign of SIGNS) {
      const conv = { inSign, outSign };
      const e = err(conv);
      if (e < best.errDeg) best = { conv, errDeg: e };
    }
  }
  return best;
}
