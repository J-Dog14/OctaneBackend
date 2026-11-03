/**
 * Server side of "TM + 3D" tab → arm + flight:
 * the throwing arm (shoulder, elbow, wrist, hand markers) from MER through release for every
 * 3D trial in a paired session, moved into the field frame with the session's 3D ↔ TrackMan
 * registration, plus each paired pitch's flight from release to the plate.
 */

import { prisma } from "@/lib/db/prisma";
import { isPitchCode, type PitchCode } from "@/lib/pitch-intel/pitch-types";
import { TrialLookup } from "../biomech/extract";
import { PITCH_CATEGORIES, type PitchCategory } from "../biomech/pitchCategory";
import { listPitchSyncSessions } from "../pitchSync";
import {
  ARM_POINTS,
  add,
  detectRelease,
  fillGaps,
  fitRegistration,
  flightPath,
  labToFieldRot,
  markerNames,
  mid,
  tmReleaseField,
  type FlightPath,
  type Registration,
  type V3,
} from "./geometry";

/** Window around release, in ms. */
const PRE_MER_MS = 60;
const POST_RELEASE_MS = 30;

export interface ArmTrial {
  category: PitchCategory;
  trialIndex: number;
  ownerFilename: string | null;
  frameRate: number;
  /** ms from ball release (0) to MER (negative). */
  merMs: number;
  /** How MER was placed: from the V3D timing metrics, or a default when they're missing. */
  /** Where release / MER / foot contact came from: V3D's event labels (exact), V3D TIMING intervals anchored on peak hand speed, or a 35 ms default for MER. */
  merSource: "event" | "v3d" | "default";
  peakHandMph: number;
  /** Frames from MER - 60 ms to release + 30 ms. Each: [ms rel. release, shoulder, elbow, medialElbow, wristRadius, wristUlna, hand] in field ft. */
  frames: Array<[number, ...V3[]]>;
  tm: {
    pitchUid: string;
    pitchNo: number | null;
    code: PitchCode;
    tilt: string | null;
    velo: number | null;
    spinRate: number | null;
    ivb: number | null;
    hb: number | null;
    confidence: string;
    /** Release-point gap after registration, ft (null if TrackMan has no release point). */
    releaseGapFt: number | null;
  } | null;
  flight: { path: FlightPath; flightMs: number } | null;
  /**
   * Stride direction from the ankle markers: lead ankle at foot contact vs the drive ankle at
   * max knee height (still on the rubber), relative to the line toward home plate.
   * + = closed (landing toward the throwing-arm side), − = open. Null without the markers/events.
   */
  stride: { closedIn: number; angleDeg: number; lengthIn: number } | null;
}

export interface ArmFlightData {
  sessionDate: string;
  sessions: string[];
  side: "left" | "right";
  throws: "L" | "R";
  /** Null when fewer than 2 paired pitches have a TrackMan release point: arm is then shown in lab position only. */
  registration: Pick<Registration, "offset" | "n" | "rmsFt"> | null;
  trials: ArmTrial[];
  /** Trials skipped (no marker data / markers missing), with the reason. */
  skipped: Array<{ category: PitchCategory; trialIndex: number; reason: string }>;
}

type TrialRow = {
  pitch_category: string;
  trial_index: number;
  owner_filename: string | null;
  handedness: string | null;
  m: Record<string, unknown> | null;
  /** V3D EVENT_LABEL times (s from the start of the cropped capture = marker frame / frame rate); null before the events backfill. */
  events: Record<string, unknown> | null;
  frame_rate: number | null;
  label_names: unknown;
  pitch_uid: string | null;
  confidence: string | null;
  pitch_no: number | null;
  pitch_type: string | null;
  pitcher_throws: string | null;
  tilt: string | null;
  rel_speed: number | null;
  spin_rate: number | null;
  ivb: number | null;
  hb: number | null;
  rel_height: number | null;
  rel_side: number | null;
  extension: number | null;
  plate_loc_height: number | null;
  plate_loc_side: number | null;
};

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function asV3(v: unknown): V3 | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const p = [Number(v[0]), Number(v[1]), Number(v[2])];
  return p.every((x) => Number.isFinite(x)) && !(p[0] === 0 && p[1] === 0 && p[2] === 0) ? (p as V3) : null;
}

/**
 * Event frames in the marker data.
 * - Preferred: V3D's EVENT_LABEL times (f_pitching_trials.events, labeled by hand in V3D), which are
 *   seconds from the start of the cropped capture, i.e. marker frame / frame rate. Used as they are.
 * - Fallback: V3D's TIMING metrics. Those are measured from V3D's SETUP event, not from frame 0, so
 *   only their intervals are usable; they're anchored on the peak-hand-speed release in the markers.
 */
interface EventFrames {
  release: number;
  mer: number | null;
  fc: number | null;
  mkh: number | null;
  source: "event" | "v3d" | "default";
}

function eventFrames(events: Record<string, unknown> | null, lookup: TrialLookup, peakRelease: number, frameRate: number, nFrames: number): EventFrames {
  const ev = (...names: string[]) => {
    for (const n of names) {
      const v = num(Array.isArray(events?.[n]) ? (events![n] as unknown[])[0] : events?.[n]);
      if (v != null) {
        const f = Math.round(v * frameRate);
        if (f >= 0 && f < nFrames) return f;
      }
    }
    return null;
  };
  const rel = ev("Release");
  // Joey's hand-placed V3D events are the reference: used as labeled whenever they're stored.
  if (rel != null) {
    const mer = ev("Max_Shoulder_Rot");
    return { release: rel, mer: mer != null && mer < rel ? mer : null, fc: ev("Footstrike", "Foot_Contact"), mkh: ev("MaxKneeHeight"), source: "event" };
  }
  const relT = lookup.get("ReleaseTime");
  const at = (t: number | null, lo: number, hi: number) => {
    if (relT == null || t == null) return null;
    const gap = relT - t;
    return gap >= lo && gap <= hi ? peakRelease - Math.round(gap * frameRate) : null;
  };
  const mer = at(lookup.get("Max_Shoulder_RotTime"), 0.005, 0.12);
  return {
    release: peakRelease,
    mer,
    fc: at(lookup.get("FootstrikeTime"), 0.05, 0.4),
    mkh: at(lookup.get("MaxKneeHeightTime"), 0.05, 3),
    source: mer != null ? "v3d" : "default",
  };
}

/**
 * Stride direction (lab mm: +Y toward home, +X = pitcher's right): lead ankle at foot contact vs the
 * drive ankle at max knee height. + = closed: toward the throwing-arm side (3B side for a RHP, 1B for a LHP).
 */
function strideFrom(ankles: Array<Array<V3 | null>> | null, fs: number | null, mkh: number | null, throws: "L" | "R"): ArmTrial["stride"] {
  if (!ankles || fs == null || mkh == null || fs < 0 || mkh < 0 || mkh >= fs) return null;
  const at = (k: number, i: number) => ankles[k]![i] ?? null;
  const [la, lm, ba, bm] = [at(0, fs), at(1, fs), at(2, mkh), at(3, mkh)];
  if (!la || !lm || !ba || !bm) return null;
  const leadP = mid(la, lm);
  const backP = mid(ba, bm);
  const sign = throws === "L" ? -1 : 1;
  const dx = (leadP[0] - backP[0]) * sign;
  const dy = leadP[1] - backP[1];
  if (dy <= 200) return null; // under ~8 in forward: markers or events are off
  return {
    closedIn: Math.round((dx / 25.4) * 10) / 10,
    angleDeg: Math.round(((Math.atan2(dx, dy) * 180) / Math.PI) * 10) / 10,
    lengthIn: Math.round((Math.hypot(dx, dy) / 25.4) * 10) / 10,
  };
}

export async function buildArmFlight(athleteUuid: string, date?: string | null): Promise<ArmFlightData | null> {
  const sessions = await listPitchSyncSessions(athleteUuid);
  if (!sessions.length) return null;
  const sessionDate = date && sessions.includes(date) ? date : sessions[0]!;

  const rows = await prisma.$queryRawUnsafe<TrialRow[]>(
    `SELECT t.pitch_category, t.trial_index, t.owner_filename, t.handedness,
            (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(t.metrics::jsonb) e
              WHERE split_part(e.key, '.', 2) = ANY(ARRAY['ReleaseTime', 'Max_Shoulder_RotTime', 'FootstrikeTime', 'Foot_ContactTime', 'MaxKneeHeightTime'])) AS m,
            to_jsonb(t) -> 'events' AS events,
            td.frame_rate::float8 AS frame_rate, md.label_names,
            l.pitch_uid, l.confidence, p.pitch_no, p.pitch_type, p.pitcher_throws, COALESCE(p.tilt, p.measured_tilt) AS tilt,
            p.rel_speed::float8 AS rel_speed, p.spin_rate::float8 AS spin_rate, p.ivb::float8 AS ivb, p.hb::float8 AS hb,
            p.rel_height::float8 AS rel_height, p.rel_side::float8 AS rel_side, p.extension::float8 AS extension,
            p.plate_loc_height::float8 AS plate_loc_height, p.plate_loc_side::float8 AS plate_loc_side
       FROM public.f_pitching_trials t
       LEFT JOIN public.f_pitching_time_data td
              ON td.athlete_uuid = t.athlete_uuid AND td.session_date = t.session_date
             AND td.pitch_category = t.pitch_category AND td.trial_index = t.trial_index
       LEFT JOIN public.f_pitching_marker_data md
              ON md.athlete_uuid = t.athlete_uuid AND md.session_date = t.session_date
             AND md.pitch_category = t.pitch_category AND md.trial_index = t.trial_index
       LEFT JOIN pitch_intel.biomech_trackman_links l
              ON l.athlete_uuid = t.athlete_uuid AND l.session_date = t.session_date
             AND l.pitch_category = t.pitch_category AND l.trial_index = t.trial_index
       LEFT JOIN pitch_intel.trackman_pitches p ON p.pitch_uid = l.pitch_uid
      WHERE t.athlete_uuid = $1 AND t.session_date = $2::date
      ORDER BY t.capture_time NULLS LAST, t.pitch_category, t.trial_index`,
    athleteUuid,
    sessionDate,
  );
  if (!rows.length) return null;

  const hand = (
    rows.find((r) => r.handedness)?.handedness ??
    rows.find((r) => r.pitcher_throws)?.pitcher_throws ??
    "R"
  ).toUpperCase();
  const throws: "L" | "R" = hand.startsWith("L") ? "L" : "R";
  const side = throws === "L" ? "left" : "right";
  const names = markerNames(side);
  // Ankles (lateral + medial): lead leg is the glove side.
  const lead = throws === "L" ? "right" : "left";
  const back = throws === "L" ? "left" : "right";
  const ANKLES = [`${lead}_ankle`, `${lead}_medial_ankle`, `${back}_ankle`, `${back}_medial_ankle`];

  const skipped: ArmFlightData["skipped"] = [];
  type Raw = { order: number; row: TrialRow; category: PitchCategory; frameRate: number; series: Array<Array<V3 | null>>; ankles: Array<Array<V3 | null>> | null };
  const raws: Raw[] = [];

  // One small query per trial: only the six arm markers, every frame.
  await Promise.all(
    rows.map(async (row, order) => {
      const category = (PITCH_CATEGORIES as string[]).includes(row.pitch_category) ? (row.pitch_category as PitchCategory) : "pitch";
      const labels = Array.isArray(row.label_names) ? (row.label_names as unknown[]).map((x) => String(x).toLowerCase()) : null;
      if (!labels) {
        skipped.push({ category, trialIndex: row.trial_index, reason: "no marker data" });
        return;
      }
      const idx = ARM_POINTS.map((id) => labels.indexOf(names[id].toLowerCase()));
      const missing = ARM_POINTS.filter((_, i) => idx[i]! < 0);
      if (missing.length) {
        skipped.push({ category, trialIndex: row.trial_index, reason: `missing markers: ${missing.map((m) => names[m]).join(", ")}` });
        return;
      }
      // Missing ankle markers -> an index past the end (jsonb -> returns NULL; a negative index would count from the end).
      const ankleIdx = ANKLES.map((n) => labels.indexOf(n));
      const haveAnkles = ankleIdx.every((i) => i >= 0);
      const res = await prisma.$queryRawUnsafe<Array<{ f: unknown }>>(
        `SELECT jsonb_agg(jsonb_build_array(f.val -> $5::int, f.val -> $6::int, f.val -> $7::int, f.val -> $8::int, f.val -> $9::int, f.val -> $10::int,
                                            f.val -> $11::int, f.val -> $12::int, f.val -> $13::int, f.val -> $14::int)
                          ORDER BY f.ord) AS f
           FROM public.f_pitching_marker_data m, jsonb_array_elements(m.data) WITH ORDINALITY f(val, ord)
          WHERE m.athlete_uuid = $1 AND m.session_date = $2::date AND m.pitch_category = $3 AND m.trial_index = $4`,
        athleteUuid,
        sessionDate,
        row.pitch_category,
        row.trial_index,
        ...idx,
        ...ankleIdx.map((i) => (i >= 0 ? i : 1_000_000)),
      );
      const frames = Array.isArray(res[0]?.f) ? (res[0]!.f as unknown[][]) : [];
      if (!frames.length) {
        skipped.push({ category, trialIndex: row.trial_index, reason: "no marker frames" });
        return;
      }
      const series = ARM_POINTS.map((_, k) => fillGaps(frames.map((fr) => asV3(fr?.[k]))));
      const ankles = haveAnkles ? ANKLES.map((_, k) => fillGaps(frames.map((fr) => asV3(fr?.[ARM_POINTS.length + k])))) : null;
      raws.push({ order, row, category, frameRate: num(row.frame_rate) ?? 300, series, ankles });
    }),
  );

  // Release + MER per trial (lab), then the registration from the paired ones.
  type Prepared = Raw & { release: number; mer: number; merSource: ArmTrial["merSource"]; peakMph: number; handAtRelease: V3; stride: ArmTrial["stride"] };
  const prepared: Prepared[] = [];
  raws.sort((a, b) => a.order - b.order); // queries finish in any order; keep capture order
  for (const r of raws) {
    const handSeries = r.series[ARM_POINTS.indexOf("hand")]!;
    const rel = detectRelease(handSeries, r.frameRate);
    if (!rel || !handSeries[rel.frame]) {
      skipped.push({ category: r.category, trialIndex: r.row.trial_index, reason: "couldn't find release (hand marker)" });
      continue;
    }
    const lookup = new TrialLookup(r.row.m ?? {});
    const ef = eventFrames(r.row.events, lookup, rel.frame, r.frameRate, handSeries.length);
    const merFrame = ef.mer ?? ef.release - Math.round(0.035 * r.frameRate);
    const stride = strideFrom(r.ankles, ef.fc, ef.mkh, throws);
    const hand = handSeries[ef.release] ?? handSeries[rel.frame]!;
    prepared.push({ ...r, release: ef.release, mer: Math.max(0, merFrame), merSource: ef.source, peakMph: rel.peakMph, handAtRelease: hand, stride });
  }

  const pairs = prepared.flatMap((p) => {
    const tm =
      p.row.pitch_uid != null
        ? tmReleaseField({ pitchUid: p.row.pitch_uid, relSide: num(p.row.rel_side), relHeight: num(p.row.rel_height), extension: num(p.row.extension) })
        : null;
    return tm ? [{ pitchUid: p.row.pitch_uid!, handLabMm: p.handAtRelease, tm }] : [];
  });
  const reg = fitRegistration(pairs);
  const offset: V3 = reg?.offset ?? [0, 0, 0];

  const trials: ArmTrial[] = prepared.map((p) => {
    const lo = Math.max(0, p.mer - Math.round((PRE_MER_MS / 1000) * p.frameRate));
    const hi = Math.min(p.series[0]!.length - 1, p.release + Math.round((POST_RELEASE_MS / 1000) * p.frameRate));
    const frames: ArmTrial["frames"] = [];
    for (let i = lo; i <= hi; i++) {
      const pts = p.series.map((s) => add(labToFieldRot(s[i]!), offset));
      frames.push([((i - p.release) / p.frameRate) * 1000, ...pts]);
    }
    const r = p.row;
    const code: PitchCode = isPitchCode(r.pitch_type) ? r.pitch_type : "OTHER";
    return {
      category: p.category,
      trialIndex: r.trial_index,
      ownerFilename: r.owner_filename,
      frameRate: p.frameRate,
      merMs: ((p.mer - p.release) / p.frameRate) * 1000,
      merSource: p.merSource,
      peakHandMph: Math.round(p.peakMph * 10) / 10,
      frames,
      tm: r.pitch_uid
        ? {
            pitchUid: r.pitch_uid,
            pitchNo: num(r.pitch_no),
            code,
            tilt: r.tilt,
            velo: num(r.rel_speed),
            spinRate: num(r.spin_rate),
            ivb: num(r.ivb),
            hb: num(r.hb),
            confidence: r.confidence ?? "review",
            releaseGapFt: reg?.residualFt[r.pitch_uid] ?? null,
          }
        : null,
      stride: p.stride,
      flight: r.pitch_uid
        ? flightPath({
            veloMph: num(r.rel_speed),
            relSide: num(r.rel_side),
            relHeight: num(r.rel_height),
            extension: num(r.extension),
            plateSide: num(r.plate_loc_side),
            plateHeight: num(r.plate_loc_height),
            ivbIn: num(r.ivb),
            hbIn: num(r.hb),
          })
        : null,
    };
  });

  return {
    sessionDate,
    sessions,
    side,
    throws,
    registration: reg ? { offset: reg.offset, n: reg.n, rmsFt: reg.rmsFt } : null,
    trials,
    skipped,
  };
}
