/**
 * Everything the coach suite's Pitching tab shows for one athlete, in one
 * payload: Savant seasons (per pitch type, xArsenal-graded), Savant games,
 * Trackman sessions and screenshot reports (from lib/pitch-intel/sessions),
 * and a velocity series across all sources.
 *
 * Conventions match lib/pitch-intel/sessions.ts: HB is arm-side positive
 * (inches), IVB in inches, whiff% is per swing, swings/whiffs follow Ryan's
 * parser (foul tips are swings, not whiffs).
 */

import { getDb } from "@/lib/pitch-intel/db";
import { PITCH_LABELS, isPitchCode, type PitchCode } from "@/lib/pitch-intel/pitch-types";
import {
  attachGrades,
  getAthleteSessions,
  type AthleteSessions,
  type PitchTypeSummary,
  type ReportSummary,
  type SessionSummary,
} from "@/lib/pitch-intel/sessions";

/** Pitches of one type needed in a Savant season to grade it. */
const SEASON_GRADE_MIN = 10;
const GAMES_LIMIT = 60;

export interface SavantSeason {
  season: number;
  pitches: number;
  games: number;
  firstDate: string;
  lastDate: string;
  byType: PitchTypeSummary[];
  arsenal: SessionSummary["arsenal"];
}

export interface SavantGame {
  date: string;
  gamePk: string;
  opponent: string | null;
  pitches: number;
  strikePct: number | null;
  cswPct: number | null;
  whiffPct: number | null;
  whiffs: number;
  strikeouts: number;
  walks: number;
  fbVelo: number | null;
  fbVeloMax: number | null;
}

export interface VeloPoint {
  date: string;
  source: "savant" | "trackman";
  sessionType: "game" | "bullpen";
  pitchType: PitchCode;
  velo: number;
  veloMax: number | null;
  n: number;
}

export interface ArsenalSnapshot {
  source: "savant" | "trackman" | "report";
  /** Most recent date the snapshot covers. */
  date: string;
  label: string;
  byType: PitchTypeSummary[];
  arsenal: SessionSummary["arsenal"];
}

export interface CoachPitching {
  athlete: AthleteSessions["athlete"];
  hasAnyData: boolean;
  seasons: SavantSeason[];
  games: SavantGame[];
  sessions: SessionSummary[];
  reports: ReportSummary[];
  velo: VeloPoint[];
  /** Newest graded arsenal across Savant seasons, Trackman sessions and reports. */
  latest: ArsenalSnapshot | null;
  /**
   * Set when the Trackman / screenshot-report tables haven't been created on
   * this database yet (`npm run pi:setup` adds them). Savant data still shows.
   */
  uploadTablesMissing: boolean;
}

const MISSING_RELATION = /42P01|relation "pitch_intel\.[a-z_]+" does not exist/;

/**
 * getAthleteSessions without the Trackman / report tables: athlete, throws and
 * level from the links, no sessions or reports.
 */
async function sessionsWithoutUploads(athleteUuid: string): Promise<AthleteSessions | null> {
  const conn = await getDb();
  const athleteRows = await conn.query<{ name: string }>(`SELECT name FROM analytics.d_athletes WHERE athlete_uuid = $1`, athleteUuid);
  if (!athleteRows.length) return null;
  const links = await conn.query<{ source: string; throws: string | null; level: string | null; league: string | null }>(
    `SELECT source, throws, level, league FROM pitch_intel.athlete_source_links WHERE athlete_uuid = $1 ORDER BY (source = 'savant') DESC, id`,
    athleteUuid,
  );
  const savant = links.find((l) => l.source === "savant");
  const throwsRaw = links.find((l) => l.throws)?.throws ?? null;
  return {
    athlete: {
      athleteUuid,
      name: athleteRows[0]!.name,
      throws: throwsRaw === "L" || throwsRaw === "R" ? throwsRaw : null,
      level: savant?.league || savant?.level || links.find((l) => l.level)?.level || null,
      hasSavant: !!savant,
    },
    sessions: [],
    reports: [],
  };
}

const r1 = (v: unknown) => (v == null ? null : Math.round(Number(v) * 10) / 10);
const code = (v: string): PitchCode => (isPitchCode(v) ? v : "OTHER");

const SWING = `(description LIKE '%swinging_strike%' OR description LIKE '%foul%' OR description = 'hit_into_play')`;
const WHIFF = `(description LIKE '%swinging_strike%')`;
const STRIKE = `(description LIKE '%swinging_strike%' OR description LIKE '%called_strike%' OR description LIKE '%foul%' OR description = 'hit_into_play')`;
const CSW = `(description LIKE '%swinging_strike%' OR description LIKE '%called_strike%')`;
// Vertical approach angle at the front of the plate from Statcast's release
// kinematics (y = 50 ft to y = 17/12 ft), same physics as Ryan's parser.
const VAA = `degrees(atan(
    (vz0 + az * ((-sqrt(greatest(vy0 * vy0 - 2 * ay * (50 - 17.0 / 12), 0)) - vy0) / nullif(ay, 0)))
    / nullif(abs(-sqrt(greatest(vy0 * vy0 - 2 * ay * (50 - 17.0 / 12), 0))), 0)))`;

async function savantSeasons(athleteUuid: string, throws: "L" | "R" | null, level: string | null): Promise<SavantSeason[]> {
  const conn = await getDb();
  const rows = await conn.query<{
    season: number; pitch_type: string; n: number; total: number; first_date: string; last_date: string;
    velo: number | null; velo_max: number | null; spin: number | null; ivb: number | null; hb_arm: number | null;
    ext: number | null; rel_h: number | null; rel_s: number | null; vaa: number | null; swings: number; whiffs: number;
  }>(
    `SELECT game_year::int AS season, pitch_type, count(*)::int AS n,
            (sum(count(*)) OVER (PARTITION BY game_year))::int AS total,
            (min(min(game_date)) OVER (PARTITION BY game_year))::text AS first_date,
            (max(max(game_date)) OVER (PARTITION BY game_year))::text AS last_date,
            avg(release_speed) AS velo, max(release_speed) AS velo_max, avg(release_spin_rate) AS spin,
            avg(pfx_z) * 12 AS ivb,
            avg(CASE WHEN p_throws = 'L' THEN pfx_x ELSE -pfx_x END) * 12 AS hb_arm,
            avg(release_extension) AS ext, avg(release_pos_z) AS rel_h, avg(release_pos_x) AS rel_s,
            avg(${VAA}) AS vaa,
            count(*) FILTER (WHERE ${SWING})::int AS swings,
            count(*) FILTER (WHERE ${WHIFF})::int AS whiffs
       FROM pitch_intel.savant_pitches
      WHERE athlete_uuid = $1 AND pitch_type IS NOT NULL AND pitch_type <> '' AND game_year IS NOT NULL
      GROUP BY game_year, pitch_type
      ORDER BY game_year DESC, n DESC`,
    athleteUuid,
  );
  const gameCounts = await conn.query<{ season: number; games: number }>(
    `SELECT game_year::int AS season, count(DISTINCT game_pk)::int AS games
       FROM pitch_intel.savant_pitches WHERE athlete_uuid = $1 AND game_year IS NOT NULL GROUP BY game_year`,
    athleteUuid,
  );
  const gamesBySeason = new Map(gameCounts.map((g) => [g.season, g.games]));

  const map = new Map<number, SavantSeason>();
  for (const r of rows) {
    if (!map.has(r.season)) {
      map.set(r.season, {
        season: r.season, pitches: r.total, games: gamesBySeason.get(r.season) ?? 0,
        firstDate: r.first_date, lastDate: r.last_date, byType: [], arsenal: null,
      });
    }
    const c = code(r.pitch_type);
    const s = map.get(r.season)!;
    // Statcast codes outside the app's set (KN, EP, SV, FO, SC…) fold into OTHER.
    const existing = s.byType.find((t) => t.pitchType === c);
    if (existing && c === "OTHER") {
      existing.count = (existing.count ?? 0) + r.n;
      existing.usagePct = r.total ? r1(((existing.count ?? 0) / r.total) * 100) : null;
      continue;
    }
    s.byType.push({
      pitchType: c,
      label: PITCH_LABELS[c],
      count: r.n,
      usagePct: r.total ? r1((r.n / r.total) * 100) : null,
      velo: r1(r.velo),
      veloMax: r1(r.velo_max),
      spinRate: r.spin == null ? null : Math.round(Number(r.spin)),
      ivb: r1(r.ivb),
      hbArm: r1(r.hb_arm),
      extension: r1(r.ext),
      relHeight: r1(r.rel_h),
      relSide: r1(r.rel_s),
      vaa: r1(r.vaa),
      spinEfficiency: null,
      whiffPct: r.swings ? r1((r.whiffs / r.swings) * 100) : null,
      swings: r.swings,
      grade: null,
    });
  }
  const seasons = [...map.values()];
  for (const s of seasons) s.arsenal = attachGrades(s.byType, throws, level, SEASON_GRADE_MIN);
  return seasons;
}

async function savantGames(athleteUuid: string): Promise<SavantGame[]> {
  const conn = await getDb();
  const rows = await conn.query<{
    date: string; game_pk: string; opponent: string | null; n: number; strikes: number; csw: number; swings: number; whiffs: number;
    ks: number; bbs: number; fb_velo: number | null; fb_velo_max: number | null;
  }>(
    `SELECT game_date::text AS date, game_pk::text AS game_pk,
            max(CASE WHEN inning_topbot = 'Top' THEN away_team ELSE home_team END) AS opponent,
            count(*)::int AS n,
            count(*) FILTER (WHERE ${STRIKE})::int AS strikes,
            count(*) FILTER (WHERE ${CSW})::int AS csw,
            count(*) FILTER (WHERE ${SWING})::int AS swings,
            count(*) FILTER (WHERE ${WHIFF})::int AS whiffs,
            count(*) FILTER (WHERE events IN ('strikeout', 'strikeout_double_play'))::int AS ks,
            count(*) FILTER (WHERE events IN ('walk', 'intent_walk'))::int AS bbs,
            avg(release_speed) FILTER (WHERE pitch_type IN ('FF', 'SI')) AS fb_velo,
            max(release_speed) FILTER (WHERE pitch_type IN ('FF', 'SI')) AS fb_velo_max
       FROM pitch_intel.savant_pitches
      WHERE athlete_uuid = $1
      GROUP BY game_date, game_pk
      ORDER BY game_date DESC, game_pk DESC
      LIMIT ${GAMES_LIMIT}`,
    athleteUuid,
  );
  return rows.map((r) => ({
    date: r.date,
    gamePk: r.game_pk,
    opponent: r.opponent,
    pitches: r.n,
    strikePct: r.n ? r1((r.strikes / r.n) * 100) : null,
    cswPct: r.n ? r1((r.csw / r.n) * 100) : null,
    whiffPct: r.swings ? r1((r.whiffs / r.swings) * 100) : null,
    whiffs: r.whiffs,
    strikeouts: r.ks,
    walks: r.bbs,
    fbVelo: r1(r.fb_velo),
    fbVeloMax: r1(r.fb_velo_max),
  }));
}

async function savantVelo(athleteUuid: string): Promise<VeloPoint[]> {
  const conn = await getDb();
  const rows = await conn.query<{ date: string; pitch_type: string; velo: number; velo_max: number | null; n: number }>(
    `SELECT game_date::text AS date, pitch_type, avg(release_speed) AS velo, max(release_speed) AS velo_max, count(*)::int AS n
       FROM pitch_intel.savant_pitches
      WHERE athlete_uuid = $1 AND release_speed IS NOT NULL AND pitch_type IS NOT NULL AND pitch_type <> ''
      GROUP BY game_date, pitch_type
      ORDER BY game_date`,
    athleteUuid,
  );
  return rows.map((r) => ({
    date: r.date, source: "savant" as const, sessionType: "game" as const, pitchType: code(r.pitch_type),
    velo: r1(r.velo)!, veloMax: r1(r.velo_max), n: r.n,
  }));
}

function pickLatest(seasons: SavantSeason[], sessions: SessionSummary[], reports: ReportSummary[]): ArsenalSnapshot | null {
  const candidates: ArsenalSnapshot[] = [];
  for (const s of seasons) {
    if (s.arsenal) candidates.push({ source: "savant", date: s.lastDate, label: `${s.season} season · Savant`, byType: s.byType, arsenal: s.arsenal });
  }
  for (const s of sessions) {
    if (s.arsenal) candidates.push({ source: "trackman", date: s.date, label: `${s.date} ${s.sessionType} · Trackman`, byType: s.byType, arsenal: s.arsenal });
  }
  for (const r of reports) {
    const date = r.date ?? r.createdAt.slice(0, 10);
    if (r.arsenal) candidates.push({ source: "report", date, label: `${date} · ${r.title ?? "saved report"}`, byType: r.byType, arsenal: r.arsenal });
  }
  candidates.sort((a, b) => b.date.localeCompare(a.date));
  return candidates[0] ?? null;
}

/** Null when the athlete doesn't exist. */
export async function getCoachPitching(athleteUuid: string): Promise<CoachPitching | null> {
  let uploadTablesMissing = false;
  const [base, games, savantVeloPoints] = await Promise.all([
    getAthleteSessions(athleteUuid).catch((err) => {
      if (!MISSING_RELATION.test(String(err instanceof Error ? err.message : err))) throw err;
      uploadTablesMissing = true;
      return sessionsWithoutUploads(athleteUuid);
    }),
    savantGames(athleteUuid),
    savantVelo(athleteUuid),
  ]);
  if (!base) return null;
  const { throws, level } = base.athlete;
  const seasons = await savantSeasons(athleteUuid, throws, level);

  const trackmanVelo: VeloPoint[] = [];
  for (const s of base.sessions) {
    for (const t of s.byType) {
      if (t.velo == null) continue;
      trackmanVelo.push({
        date: s.date, source: "trackman", sessionType: s.sessionType, pitchType: t.pitchType,
        velo: t.velo, veloMax: t.veloMax, n: t.count ?? 0,
      });
    }
  }
  const velo = [...savantVeloPoints, ...trackmanVelo].sort((a, b) => a.date.localeCompare(b.date));

  return {
    athlete: base.athlete,
    hasAnyData: seasons.length > 0 || base.sessions.length > 0 || base.reports.length > 0,
    seasons,
    games,
    sessions: base.sessions,
    reports: base.reports,
    velo,
    latest: pickLatest(seasons, base.sessions, base.reports),
    uploadTablesMissing,
  };
}
