/**
 * Joint angles at a moment V3D doesn't export (e.g. 10 ms after release), rebuilt from the stored
 * segment orientations (see jointAngles.ts). Server-only: reads f_pitching_segment_rot_data.
 *
 * For each trial: the hand-placed V3D events give the frames (time × frame rate, the same frames
 * the marker / segment data use). Each joint's sign convention is calibrated against V3D's own
 * values at foot contact, MER and release for that trial, then applied at release + offset.
 * Only angles — angular velocities aren't reproduced.
 */

import { calibrate, jointAngles, jointSegments, MATCH_TOL_DEG, type CalSample, type JointId, type V3 } from "./jointAngles";
import type { TrialLookup } from "./extract";

export type Query = <T>(sql: string, ...params: unknown[]) => Promise<T[]>;

export const COMPUTED_JOINTS: JointId[] = [
  "Pitching_Hand_Angle",
  "Pitching_Elbow_Angle",
  "Pitching_Shoulder_Angle",
  "Trunk_Angle",
  "Pelvis_Angle",
  "Trunk_wrt_Pelvis_FE",
];

/** V3D events used to calibrate (first name found wins; foot contact has two spellings). */
const CAL_EVENTS: string[][] = [["Footstrike", "Foot_Contact"], ["Max_Shoulder_Rot"], ["Release"]];

export interface SegAtTrial {
  category: string;
  trialIndex: number;
  /** f_pitching_trials.events (s from the start of the cropped capture). */
  events: Record<string, unknown> | null;
  frameRate: number | null;
  /** "Left" / "Right" (f_pitching_time_data.handedness), else the athlete's throwing hand. */
  hand: "L" | "R" | null;
  lookup: TrialLookup;
}

export interface SegAtResult {
  /** Joint → [X, Y, Z] at release + offset; missing when that joint didn't reproduce V3D. */
  angles: Partial<Record<JointId, V3>>;
  /** Worst calibration error per joint (deg). */
  calErrDeg: Partial<Record<JointId, number>>;
  /** Why nothing could be computed (no events / rotation data / frame rate). */
  skipped: string | null;
}

const num = (v: unknown): number | null => {
  const x = Array.isArray(v) ? v[0] : v;
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
const key = (category: string, trialIndex: number) => `${category}:${trialIndex}`;

function eventTime(events: Record<string, unknown> | null, names: string[]): number | null {
  for (const n of names) {
    const t = num(events?.[n]);
    if (t != null) return t;
  }
  return null;
}

const isTriple = (v: unknown): v is V3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));

/**
 * Compute joint angles `offsetMs` after release for one session's trials. Returns a map keyed
 * "category:trialIndex". One SQL round trip (only the needed frames are pulled from the JSON).
 */
export async function computeSegAt(query: Query, athleteUuid: string, sessionDate: string, trials: SegAtTrial[], offsetMs: number): Promise<Map<string, SegAtResult>> {
  const out = new Map<string, SegAtResult>();
  // Frames wanted per trial: the 3 calibration events + release + offset.
  const plan: Array<{ cat: string; trial: number; idx: number[] }> = [];
  for (const t of trials) {
    const k = key(t.category, t.trialIndex);
    const fr = t.frameRate;
    const rel = eventTime(t.events, ["Release"]);
    if (!t.events || rel == null) {
      out.set(k, { angles: {}, calErrDeg: {}, skipped: "no V3D events stored" });
      continue;
    }
    if (!fr || fr <= 0) {
      out.set(k, { angles: {}, calErrDeg: {}, skipped: "no frame rate" });
      continue;
    }
    const cal = CAL_EVENTS.map((names) => eventTime(t.events, names));
    const idx = [...cal.map((s) => (s == null ? -1 : Math.round(s * fr))), Math.round(rel * fr) + Math.round((offsetMs / 1000) * fr)];
    plan.push({ cat: t.category, trial: t.trialIndex, idx });
  }
  if (!plan.length) return out;

  const rows = await query<{ cat: string; trial: number; names: unknown; frames: unknown }>(
    `SELECT r.cat, r.trial, sr.segment_names AS names,
            (SELECT jsonb_agg(CASE WHEN i.v::int >= 0 THEN sr.data::jsonb -> (i.v::int) END ORDER BY i.o)
               FROM jsonb_array_elements_text(r.idx) WITH ORDINALITY AS i(v, o)) AS frames
       FROM jsonb_to_recordset($3::jsonb) AS r(cat text, trial int, idx jsonb)
       JOIN public.f_pitching_segment_rot_data sr
         ON sr.athlete_uuid = $1 AND sr.session_date = $2::date AND sr.pitch_category = r.cat AND sr.trial_index = r.trial`,
    athleteUuid,
    sessionDate,
    JSON.stringify(plan),
  );
  const byKey = new Map(rows.map((r) => [key(r.cat, Number(r.trial)), r]));

  for (const t of trials) {
    const k = key(t.category, t.trialIndex);
    if (out.has(k)) continue;
    const row = byKey.get(k);
    const names = Array.isArray(row?.names) ? (row!.names as unknown[]).map(String) : null;
    const frames = Array.isArray(row?.frames) ? (row!.frames as unknown[]) : null;
    if (!row || !names || !frames) {
      out.set(k, { angles: {}, calErrDeg: {}, skipped: "no segment rotation data" });
      continue;
    }
    const side = t.hand ?? "R";
    const segs = jointSegments(side);
    const at = (fi: number, seg: string | null): V3 | null => {
      if (seg == null) return null;
      const f = frames[fi];
      const s = Array.isArray(f) ? f[names.indexOf(seg)] : null;
      return isTriple(s) ? s : null;
    };
    const res: SegAtResult = { angles: {}, calErrDeg: {}, skipped: null };
    for (const j of COMPUTED_JOINTS) {
      const [p, c] = segs[j];
      const samples: CalSample[] = [];
      CAL_EVENTS.forEach((evNames, i) => {
        const dist = at(i, c);
        const prox = p ? at(i, p) : null;
        if (!dist || (p && !prox)) return;
        const name = evNames.find((n) => t.lookup.get(`${j}@${n}_X`) != null);
        if (!name) return;
        const v3d = (["X", "Y", "Z"] as const).map((a) => t.lookup.get(`${j}@${name}_${a}`));
        if (v3d.some((x) => x == null)) return;
        samples.push({ prox, dist, v3d: v3d as V3 });
      });
      // Need at least 2 events to trust a convention.
      if (samples.length < 2) continue;
      const cal = calibrate(j, samples);
      if (!cal) continue;
      res.calErrDeg[j] = cal.errDeg;
      if (cal.errDeg > MATCH_TOL_DEG) continue;
      const dist = at(3, c);
      const prox = p ? at(3, p) : null;
      if (!dist || (p && !prox)) continue;
      res.angles[j] = jointAngles(j, prox, dist, cal.conv);
    }
    out.set(k, res);
  }
  return out;
}
