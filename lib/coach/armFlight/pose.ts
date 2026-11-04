/**
 * Throwing-arm pose at a moment, from an ArmTrial's marker frames (field ft). Shared by the
 * line view (ArmFlightView) and the solid 3D view (ArmSkeleton3D).
 */

import { mid, type V3 } from "./geometry";
import type { ArmTrial } from "./load";

export type Pose = { shoulder: V3; elbow: V3; elbowLat: V3; elbowMed: V3; wrist: V3; radius: V3; ulna: V3; hand: V3 };

export function toPose(fr: [number, ...V3[]]): Pose {
  const [, shoulder, elbowLat, elbowMed, radius, ulna, hand] = fr as [number, V3, V3, V3, V3, V3, V3];
  return { shoulder, elbow: mid(elbowLat, elbowMed), elbowLat, elbowMed, wrist: mid(radius, ulna), radius, ulna, hand };
}

/** Arm pose at `ms` from release (linear between frames, held at the window ends). */
export function poseAt(t: ArmTrial, ms: number): Pose {
  const f = t.frames;
  let i = 0;
  if (ms <= f[0]![0]) i = 0;
  else if (ms >= f[f.length - 1]![0]) i = f.length - 1;
  else {
    let lo = 0;
    let hi = f.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (f[m]![0] <= ms) lo = m;
      else hi = m;
    }
    const a = f[lo]!;
    const b = f[hi]!;
    const w = (ms - a[0]) / (b[0] - a[0]);
    const lerp = (k: number): V3 => {
      const p = a[k] as V3;
      const q = b[k] as V3;
      return [p[0] + (q[0] - p[0]) * w, p[1] + (q[1] - p[1]) * w, p[2] + (q[2] - p[2]) * w];
    };
    return toPose([0, lerp(1), lerp(2), lerp(3), lerp(4), lerp(5), lerp(6)]);
  }
  return toPose(f[i]!);
}
