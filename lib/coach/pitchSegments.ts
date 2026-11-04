/**
 * Per-pitch biomechanics grid for Mechanics + Flight (client-safe, no server imports).
 *
 * Each segment = one Visual3D variable read at four events (foot contact, MER, release, +10 ms), X / Y / Z
 * (X = sagittal, Y = frontal, Z = transverse). Angles and angular velocities are
 * separate variables in the V3D export; the UI switches between them.
 * Values arrive per pitch as `seg["<variable>@<event>_<axis>"]`.
 */

export interface SegEvent {
  id: string;
  label: string;
  long: string;
  /**
   * Not in the V3D export: angles are rebuilt from the stored segment orientations at release +
   * this many ms (lib/coach/biomech/segAt.ts). Angular velocities aren't available there.
   */
  computedMs?: number;
}

export const SEG_EVENTS: SegEvent[] = [
  { id: "Footstrike", label: "@ FC", long: "at foot contact" },
  { id: "Max_Shoulder_Rot", label: "@ MER", long: "at max external rotation" },
  { id: "Release", label: "@ Rel", long: "at ball release" },
  { id: "Release10msAfter", label: "+10 ms", long: "10 ms after release", computedMs: 10 },
];

export const SEG_AXES = ["X", "Y", "Z"] as const;
export type SegAxis = (typeof SEG_AXES)[number];

export interface SegmentDef {
  id: string;
  label: string;
  /** V3D angle variable (deg), or null when the export has none for this segment. */
  angle: string | null;
  /** V3D angular velocity variable (deg/s), or null. */
  velocity: string | null;
  /** What an axis means for this segment, where we know it (from the 8-cylinder metric ids). */
  hint?: Partial<Record<SegAxis, string>>;
}

export const SEGMENTS: SegmentDef[] = [
  { id: "hand", label: "Wrist / hand", angle: "Pitching_Hand_Angle", velocity: "Pitching_Hand_Ang_Vel", hint: { X: "flex / ext", Y: "deviation" } },
  { id: "elbow", label: "Forearm / elbow", angle: "Pitching_Elbow_Angle", velocity: "Pitching_Elbow_Ang_Vel", hint: { X: "flexion", Z: "pro / sup" } },
  { id: "shoulder", label: "Shoulder", angle: "Pitching_Shoulder_Angle", velocity: "Pitching_Shoulder_Ang_Vel", hint: { X: "horiz. abd", Z: "rotation" } },
  { id: "humerus", label: "Upper arm", angle: null, velocity: "Pitching_Humerus_Ang_Vel" },
  { id: "trunk", label: "Trunk", angle: "Trunk_Angle", velocity: "Thorax_Ang_Vel", hint: { X: "flex / ext", Y: "lateral tilt" } },
  // Pelvis before trunk-wrt-pelvis so that, two cards per row, trunk-wrt-pelvis sits right under trunk.
  { id: "pelvis", label: "Pelvis", angle: "Pelvis_Angle", velocity: "Pelvis_Ang_Vel" },
  { id: "trunkPelvis", label: "Trunk wrt pelvis", angle: "Trunk_wrt_Pelvis_FE", velocity: null, hint: { Y: "posture" } },
];

export const segKey = (variable: string, event: string, axis: SegAxis) => `${variable}@${event}_${axis}`;

/** "Variable@Event" names to pull from the trial metrics JSON. */
export const SEGMENT_VARIABLES: string[] = SEGMENTS.flatMap((s) =>
  [s.angle, s.velocity].filter((v): v is string => !!v).flatMap((v) => SEG_EVENTS.filter((e) => e.computedMs == null).map((e) => `${v}@${e.id}`)),
);
