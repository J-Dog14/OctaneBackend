/**
 * Pitch-by-pitch data for the coach suite's pitch report (the TrackMan-style
 * view) and the metric trend charts. Trackman (portal pulls + CSV uploads) and
 * Savant are normalized into one row shape.
 *
 * Sign conventions (every side measure is from the PITCHER's view, + = the
 * pitcher's right, which is how TrackMan reports them):
 *   - hb, relSide, plateSide, haa: Trackman as stored; Savant's catcher-view
 *     values (pfx_x, release_pos_x, plate_x, vx) are negated.
 *   - hbArm: arm side positive (= hb for RHP, -hb for LHP), the suite's
 *     convention for movement plots and tables.
 * Savant VAA/HAA come from the release kinematics at the front of the plate
 * (y = 17/12 ft), the same physics as Ryan's parser.
 */

import { getDb } from "@/lib/pitch-intel/db";
import { isPitchCode, type PitchCode } from "@/lib/pitch-intel/pitch-types";

export type PitchSource = "trackman" | "savant";
export type SessionKind = "game" | "bullpen";
export type PitchResult = "ball" | "called" | "whiff" | "foul" | "inplay" | "hbp";

export interface PitchSessionRef {
  key: string;
  source: PitchSource;
  kind: SessionKind;
  date: string;
  pitches: number;
  /** "portal" / "file" for Trackman, opponent for Savant games. */
  detail: string | null;
}

export interface PitchRow {
  id: string;
  source: PitchSource;
  sessionKey: string;
  kind: SessionKind;
  date: string;
  /** Order within its session (1-based). */
  no: number;
  time: string | null;
  type: PitchCode;
  tagged: string | null;
  throws: "L" | "R" | null;
  velo: number | null;
  spin: number | null;
  ivb: number | null;
  hb: number | null;
  hbArm: number | null;
  relHeight: number | null;
  relSide: number | null;
  extension: number | null;
  vaa: number | null;
  haa: number | null;
  plateHeight: number | null;
  plateSide: number | null;
  spinEff: number | null;
  gyro: number | null;
  /** Clock tilt "1:45" (Trackman) or derived from Savant's spin axis. */
  tilt: string | null;
  measuredTilt: string | null;
  result: PitchResult | null;
  resultRaw: string | null;
  balls: number | null;
  strikes: number | null;
  batterSide: string | null;
  exitVelo: number | null;
  /** Savant's per-pitch strike-zone top/bottom (ft); null for Trackman. */
  zoneTop: number | null;
  zoneBot: number | null;
  /** Savant: inning / PA context for the pitch log. */
  context: string | null;
}

export interface PitchLog {
  pitches: PitchRow[];
  /** More pitches matched than PITCH_LIMIT; the newest were kept. */
  truncated: boolean;
}

export interface TrendPoint {
  date: string;
  source: PitchSource;
  kind: SessionKind;
  type: PitchCode;
  n: number;
  velo: number | null;
  veloMax: number | null;
  spin: number | null;
  ivb: number | null;
  hbArm: number | null;
  relHeight: number | null;
  relSide: number | null;
  extension: number | null;
  vaa: number | null;
  haa: number | null;
  spinEff: number | null;
  gyro: number | null;
}

export const PITCH_LIMIT = 6000;

const code = (v: string | null): PitchCode => (v && isPitchCode(v) ? v : "OTHER");
const num = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const hand = (v: unknown): "L" | "R" | null => (v === "L" || v === "R" ? v : null);

// ---------------------------------------------------------------------------
// SQL pieces
// ---------------------------------------------------------------------------

/** Trackman session key: the portal's session id, else date + type (CSV uploads). */
const TM_KEY = `COALESCE('tm:' || tm_session_id, 'tmf:' || session_date::text || ':' || session_type)`;
const SV_KEY = `('sv:' || game_pk::text)`;

// Time of flight from y = 50 ft to the front of the plate (y = 17/12 ft).
const SV_T = `((-sqrt(greatest(vy0 * vy0 - 2 * ay * (50 - 17.0 / 12), 0)) - vy0) / nullif(ay, 0))`;
const SV_VY = `(-sqrt(greatest(vy0 * vy0 - 2 * ay * (50 - 17.0 / 12), 0)))`;
const SV_VAA = `degrees(atan((vz0 + az * ${SV_T}) / nullif(abs(${SV_VY}), 0)))`;
// Pitcher's view: Statcast x is catcher's view, so flip it.
const SV_HAA = `degrees(atan(-(vx0 + ax * ${SV_T}) / nullif(abs(${SV_VY}), 0)))`;

const TM_COLS = `
  pitch_uid AS id, 'trackman' AS source, ${TM_KEY} AS session_key, session_type AS kind,
  session_date::text AS date, pitch_no AS no, pitch_time AS time, pitch_type AS type,
  tagged_pitch_type AS tagged, pitcher_throws AS throws,
  rel_speed AS velo, spin_rate AS spin, ivb, hb,
  rel_height, rel_side, extension, vaa, haa, plate_loc_height AS plate_height, plate_loc_side AS plate_side,
  spin_efficiency AS spin_eff, gyro, tilt, measured_tilt, spin_axis,
  pitch_call AS result_raw, balls, strikes, batter_side, exit_speed AS exit_velo,
  NULL::double precision AS zone_top, NULL::double precision AS zone_bot, NULL::text AS context`;

const SV_COLS = `
  (game_pk::text || '-' || at_bat_number::text || '-' || pitch_number::text) AS id, 'savant' AS source,
  ${SV_KEY} AS session_key, 'game' AS kind, game_date::text AS date,
  (row_number() OVER (PARTITION BY game_pk ORDER BY at_bat_number, pitch_number))::int AS no,
  NULL::text AS time, pitch_type AS type, pitch_name AS tagged, p_throws AS throws,
  release_speed AS velo, release_spin_rate AS spin, pfx_z * 12 AS ivb, -pfx_x * 12 AS hb,
  release_pos_z AS rel_height, -release_pos_x AS rel_side, release_extension AS extension,
  ${SV_VAA} AS vaa, ${SV_HAA} AS haa, plate_z AS plate_height, -plate_x AS plate_side,
  NULL::double precision AS spin_eff, NULL::double precision AS gyro, NULL::text AS tilt, NULL::text AS measured_tilt, spin_axis,
  description AS result_raw, balls::int AS balls, strikes::int AS strikes, stand AS batter_side, launch_speed AS exit_velo,
  sz_top AS zone_top, sz_bot AS zone_bot,
  ('Inn ' || inning::int::text || ' · PA ' || at_bat_number::int::text || ' · P' || pitch_number::int::text) AS context`;

type RawPitch = {
  id: string; source: PitchSource; session_key: string; kind: SessionKind; date: string; no: number | null; time: string | null;
  type: string | null; tagged: string | null; throws: string | null; velo: number | null; spin: number | null;
  ivb: number | null; hb: number | null; rel_height: number | null; rel_side: number | null; extension: number | null;
  vaa: number | null; haa: number | null; plate_height: number | null; plate_side: number | null; spin_eff: number | null;
  gyro: number | null; tilt: string | null; measured_tilt: string | null; spin_axis: number | null; result_raw: string | null;
  balls: number | null; strikes: number | null; batter_side: string | null; exit_velo: number | null;
  zone_top: number | null; zone_bot: number | null; context: string | null;
};

const SAVANT_RESULT: Record<string, PitchResult> = {
  ball: "ball", blocked_ball: "ball", pitchout: "ball", intent_ball: "ball", automatic_ball: "ball",
  called_strike: "called", automatic_strike: "called",
  swinging_strike: "whiff", swinging_strike_blocked: "whiff", missed_bunt: "whiff", bunt_foul_tip: "foul",
  foul: "foul", foul_tip: "foul", foul_bunt: "foul", foul_pitchout: "foul",
  hit_into_play: "inplay", hit_into_play_no_out: "inplay", hit_into_play_score: "inplay",
  hit_by_pitch: "hbp",
};

const TRACKMAN_RESULT: Record<string, PitchResult> = {
  ballcalled: "ball", ballindirt: "ball", ballintentional: "ball", balls: "ball",
  strikecalled: "called",
  strikeswinging: "whiff",
  foulball: "foul", foulballnotfieldable: "foul", foulballfieldable: "foul", foultip: "foul", foulballnotfieldablebunt: "foul",
  inplay: "inplay",
  hitbypitch: "hbp",
};

export function classifyResult(source: PitchSource, raw: string | null): PitchResult | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase();
  return source === "savant" ? SAVANT_RESULT[k] ?? null : TRACKMAN_RESULT[k.replace(/[^a-z]/g, "")] ?? null;
}

/** Statcast spin axis (deg, 180 = pure backspin) -> clock tilt from the pitcher's view, to the nearest 15 min. */
export function spinAxisToTilt(axis: number | null): string | null {
  if (axis == null || !Number.isFinite(axis)) return null;
  const minutes = Math.round(((((axis + 180) % 360) + 360) % 360) * 2 / 15) * 15; // 1 deg = 2 clock minutes
  let h = Math.floor(minutes / 60) % 12;
  const m = minutes % 60;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function toRow(r: RawPitch): PitchRow {
  const throws = hand(r.throws);
  const hb = num(r.hb);
  // Trackman CSV uploads have a spin axis but no clock tilt; same 180 = backspin convention.
  const tilt = r.tilt || spinAxisToTilt(num(r.spin_axis));
  return {
    id: r.id,
    source: r.source,
    sessionKey: r.session_key,
    kind: r.kind,
    date: r.date,
    no: num(r.no) ?? 0,
    time: r.time,
    type: code(r.type),
    tagged: r.tagged,
    throws,
    velo: num(r.velo),
    spin: num(r.spin) == null ? null : Math.round(Number(r.spin)),
    ivb: num(r.ivb),
    hb,
    hbArm: hb == null ? null : throws === "L" ? -hb : hb,
    relHeight: num(r.rel_height),
    relSide: num(r.rel_side),
    extension: num(r.extension),
    vaa: num(r.vaa),
    haa: num(r.haa),
    plateHeight: num(r.plate_height),
    plateSide: num(r.plate_side),
    spinEff: num(r.spin_eff),
    gyro: num(r.gyro),
    tilt,
    measuredTilt: r.measured_tilt || null,
    result: classifyResult(r.source, r.result_raw),
    resultRaw: r.result_raw,
    balls: num(r.balls),
    strikes: num(r.strikes),
    batterSide: r.batter_side,
    exitVelo: num(r.exit_velo),
    zoneTop: num(r.zone_top),
    zoneBot: num(r.zone_bot),
    context: r.context,
  };
}

const MISSING_RELATION = /42P01|relation "pitch_intel\.[a-z_]+" does not exist|column .* does not exist/;

async function safe<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (err) {
    // Trackman tables or the portal columns not set up yet: show Savant only.
    if (MISSING_RELATION.test(String(err instanceof Error ? err.message : err))) return [];
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Every Trackman session and Savant game for the athlete, newest first. */
export async function getPitchSessions(athleteUuid: string): Promise<PitchSessionRef[]> {
  const conn = await getDb();
  const [tm, sv] = await Promise.all([
    safe(() =>
      conn.query<{ key: string; kind: SessionKind; date: string; n: number; portal: boolean }>(
        `SELECT ${TM_KEY} AS key, session_type AS kind, min(session_date)::text AS date, count(*)::int AS n,
                bool_or(data_source = 'portal') AS portal
           FROM pitch_intel.trackman_pitches
          WHERE athlete_uuid = $1
          GROUP BY 1, 2`,
        athleteUuid,
      ),
    ),
    conn.query<{ key: string; date: string; n: number; opp: string | null }>(
      `SELECT ${SV_KEY} AS key, game_date::text AS date, count(*)::int AS n,
              max(CASE WHEN inning_topbot = 'Top' THEN away_team ELSE home_team END) AS opp
         FROM pitch_intel.savant_pitches
        WHERE athlete_uuid = $1
        GROUP BY game_pk, game_date`,
      athleteUuid,
    ),
  ]);
  const out: PitchSessionRef[] = [
    ...tm.map((r) => ({ key: r.key, source: "trackman" as const, kind: r.kind, date: r.date, pitches: r.n, detail: r.portal ? "portal" : "file" })),
    ...sv.map((r) => ({ key: r.key, source: "savant" as const, kind: "game" as const, date: r.date, pitches: r.n, detail: r.opp ? `vs ${r.opp}` : null })),
  ];
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
}

export interface PitchQuery {
  /** One session key (from getPitchSessions); wins over the date range. */
  session?: string | null;
  from?: string | null;
  to?: string | null;
  /** Which sessions to include for a range; default both. */
  kinds?: SessionKind[];
  sources?: PitchSource[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^(tm:[A-Za-z0-9-]{1,64}|tmf:\d{4}-\d{2}-\d{2}:(game|bullpen)|sv:\d{1,12})$/;

export function parsePitchQuery(sp: URLSearchParams): PitchQuery | string {
  const session = sp.get("session");
  if (session && !KEY_RE.test(session)) return "Bad session key";
  const from = sp.get("from");
  const to = sp.get("to");
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) return "Dates must be YYYY-MM-DD";
  const kinds = (sp.get("kinds") ?? "game,bullpen").split(",").filter((k): k is SessionKind => k === "game" || k === "bullpen");
  const sources = (sp.get("sources") ?? "trackman,savant").split(",").filter((s): s is PitchSource => s === "trackman" || s === "savant");
  return { session, from, to, kinds, sources };
}

/** Pitches for one session, or for a date range across sessions. */
export async function getPitchLog(athleteUuid: string, q: PitchQuery): Promise<PitchLog> {
  const conn = await getDb();
  const sources = q.sources?.length ? q.sources : ["trackman", "savant"];
  const kinds = q.kinds?.length ? q.kinds : ["game", "bullpen"];
  const limit = PITCH_LIMIT + 1;

  let tm: RawPitch[] = [];
  let sv: RawPitch[] = [];
  if (q.session) {
    if (q.session.startsWith("sv:")) {
      sv = await conn.query<RawPitch>(
        `SELECT ${SV_COLS} FROM pitch_intel.savant_pitches WHERE athlete_uuid = $1 AND game_pk::text = $2`,
        athleteUuid, q.session.slice(3),
      );
    } else {
      tm = await safe(() =>
        conn.query<RawPitch>(`SELECT ${TM_COLS} FROM pitch_intel.trackman_pitches WHERE athlete_uuid = $1 AND ${TM_KEY} = $2`, athleteUuid, q.session),
      );
    }
  } else {
    const from = q.from ?? "1900-01-01";
    const to = q.to ?? "2999-12-31";
    [tm, sv] = await Promise.all([
      sources.includes("trackman")
        ? safe(() =>
            conn.query<RawPitch>(
              `SELECT ${TM_COLS} FROM pitch_intel.trackman_pitches
                WHERE athlete_uuid = $1 AND session_date BETWEEN $2::date AND $3::date AND session_type = ANY($4::text[])
                ORDER BY session_date DESC, pitch_no DESC NULLS LAST LIMIT ${limit}`,
              athleteUuid, from, to, kinds,
            ),
          )
        : Promise.resolve([] as RawPitch[]),
      sources.includes("savant") && kinds.includes("game")
        ? conn.query<RawPitch>(
            `SELECT * FROM (SELECT ${SV_COLS} FROM pitch_intel.savant_pitches
                WHERE athlete_uuid = $1 AND game_date BETWEEN $2::date AND $3::date) p
              ORDER BY date DESC, id DESC LIMIT ${limit}`,
            athleteUuid, from, to,
          )
        : Promise.resolve([] as RawPitch[]),
    ]);
  }

  const rows = [...tm, ...sv].map(toRow);
  // Newest first for the cap, then back to chronological for display.
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.sessionKey.localeCompare(a.sessionKey) || b.no - a.no);
  const truncated = rows.length > PITCH_LIMIT;
  const kept = rows.slice(0, PITCH_LIMIT);
  kept.sort((a, b) => a.date.localeCompare(b.date) || a.sessionKey.localeCompare(b.sessionKey) || a.no - b.no);
  return { pitches: kept, truncated };
}

/** Per-session, per-pitch-type averages of every metric, for the trend charts. */
export async function getPitchTrends(athleteUuid: string): Promise<TrendPoint[]> {
  const conn = await getDb();
  type Raw = Omit<TrendPoint, "type"> & { type: string };
  const metrics = (v: { velo: string; spin: string; ivb: string; hbArm: string; relH: string; relS: string; ext: string; vaa: string; haa: string; eff: string; gyro: string }) => `
      count(*)::int AS n,
      avg(${v.velo}) AS velo, max(${v.velo}) AS "veloMax", avg(${v.spin}) AS spin, avg(${v.ivb}) AS ivb, avg(${v.hbArm}) AS "hbArm",
      avg(${v.relH}) AS "relHeight", avg(${v.relS}) AS "relSide", avg(${v.ext}) AS extension,
      avg(${v.vaa}) AS vaa, avg(${v.haa}) AS haa, avg(${v.eff}) AS "spinEff", avg(${v.gyro}) AS gyro`;
  const [tm, sv] = await Promise.all([
    safe(() =>
      conn.query<Raw>(
        `SELECT session_date::text AS date, 'trackman' AS source, session_type AS kind, pitch_type AS type,
                ${metrics({
                  velo: "rel_speed", spin: "spin_rate", ivb: "ivb", hbArm: "CASE WHEN pitcher_throws = 'L' THEN -hb ELSE hb END",
                  relH: "rel_height", relS: "rel_side", ext: "extension", vaa: "vaa", haa: "haa", eff: "spin_efficiency", gyro: "gyro",
                })}
           FROM pitch_intel.trackman_pitches
          WHERE athlete_uuid = $1
          GROUP BY session_date, session_type, pitch_type`,
        athleteUuid,
      ),
    ),
    conn.query<Raw>(
      `SELECT game_date::text AS date, 'savant' AS source, 'game' AS kind, pitch_type AS type,
              ${metrics({
                velo: "release_speed", spin: "release_spin_rate", ivb: "pfx_z * 12",
                hbArm: "CASE WHEN p_throws = 'L' THEN pfx_x ELSE -pfx_x END * 12",
                relH: "release_pos_z", relS: "-release_pos_x", ext: "release_extension", vaa: SV_VAA, haa: SV_HAA,
                eff: "NULL::double precision", gyro: "NULL::double precision",
              })}
         FROM pitch_intel.savant_pitches
        WHERE athlete_uuid = $1 AND pitch_type IS NOT NULL AND pitch_type <> ''
        GROUP BY game_date, pitch_type`,
      athleteUuid,
    ),
  ]);
  const keys = ["velo", "veloMax", "spin", "ivb", "hbArm", "relHeight", "relSide", "extension", "vaa", "haa", "spinEff", "gyro"] as const;
  return [...tm, ...sv]
    .map((r) => {
      const p = { date: r.date, source: r.source, kind: r.kind, type: code(r.type), n: Number(r.n) } as TrendPoint;
      for (const k of keys) p[k] = num(r[k]);
      return p;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
