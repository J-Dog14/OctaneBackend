/**
 * Database access for pitch_intel.*. Plain SQL through Prisma's raw query
 * (the schema isn't in schema.prisma on purpose). Every SELECT casts ids,
 * counts and dates so results are plain numbers and strings, not BigInt/Date.
 *
 * Tests and scripts can swap the connection with setDb().
 */

import { SAVANT_COLUMNS } from "./savant/columns";
import type { PitchRow } from "./savant/rows";
import { UPSERT_CHUNK_SIZE } from "./config";
import type { AthleteCandidate } from "./match";
import type { CheckFlag } from "./checks";

export interface Db {
  /** Statements that return rows (SELECT, or anything with RETURNING). */
  query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  /** Statements that return no rows. */
  exec(sql: string, ...params: unknown[]): Promise<void>;
}

let current: Db | null = null;

export function setDb(db: Db): void {
  current = db;
}

async function db(): Promise<Db> {
  if (!current) {
    const { prisma } = await import("../db/prisma");
    current = {
      query: <T,>(sql: string, ...params: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...params),
      exec: async (sql: string, ...params: unknown[]) => {
        await prisma.$executeRawUnsafe(sql, ...params);
      },
    };
  }
  return current;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunTrigger = "nightly" | "backfill" | "cli" | "ui" | "csv";
export type RunStatus = "running" | "ok" | "flagged" | "failed";

export interface Link {
  id: number;
  athlete_uuid: string;
  athlete_name: string;
  source: "savant" | "trackman";
  source_player_id: string;
  source_player_name: string;
  throws: "L" | "R" | null;
  level: string | null;
  league: string | null;
  pull_enabled: boolean;
  backfill_from: number | null;
  linked_by: string | null;
  linked_at: string;
  last_pulled_at: string | null;
  last_game_date: string | null;
}

export interface LinkWithStatus extends Link {
  pitch_count: number;
  season_count: number;
  last_run_status: RunStatus | null;
  last_run_at: string | null;
  last_run_error: string | null;
}

export interface PullRun {
  id: number;
  link_id: number | null;
  athlete_uuid: string | null;
  athlete_name: string | null;
  trigger: RunTrigger;
  date_from: string | null;
  date_to: string | null;
  rows_fetched: number;
  rows_inserted: number;
  rows_updated: number;
  status: RunStatus;
  checks: { flags?: CheckFlag[]; fatal?: string[]; [k: string]: unknown };
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

const LINK_COLUMNS = `
  l.id::int AS id, l.athlete_uuid, a.name AS athlete_name, l.source, l.source_player_id,
  l.source_player_name, l.throws, l.level, l.league, l.pull_enabled, l.backfill_from,
  l.linked_by, l.linked_at::text AS linked_at, l.last_pulled_at::text AS last_pulled_at,
  l.last_game_date::text AS last_game_date`;

// ---------------------------------------------------------------------------
// Athletes (read-only)
// ---------------------------------------------------------------------------

export async function loadAthleteCandidates(): Promise<AthleteCandidate[]> {
  return (await db()).query<AthleteCandidate>(
    `SELECT athlete_uuid, name, normalized_name, age_group, date_of_birth::text AS date_of_birth
       FROM analytics.d_athletes`,
  );
}

export async function getAthleteName(athleteUuid: string): Promise<string | null> {
  const rows = await (await db()).query<{ name: string }>(
    `SELECT name FROM analytics.d_athletes WHERE athlete_uuid = $1`,
    athleteUuid,
  );
  return rows[0]?.name ?? null;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export async function listLinks(): Promise<LinkWithStatus[]> {
  return (await db()).query<LinkWithStatus>(
    `SELECT ${LINK_COLUMNS},
            COALESCE(p.pitch_count, 0)::int AS pitch_count,
            COALESCE(p.season_count, 0)::int AS season_count,
            r.status AS last_run_status, r.started_at::text AS last_run_at, r.error AS last_run_error
       FROM pitch_intel.athlete_source_links l
       JOIN analytics.d_athletes a ON a.athlete_uuid = l.athlete_uuid
       LEFT JOIN LATERAL (
         SELECT count(*) AS pitch_count, count(DISTINCT EXTRACT(YEAR FROM game_date)) AS season_count
           FROM pitch_intel.savant_pitches sp WHERE sp.link_id = l.id AND l.source = 'savant'
         UNION ALL
         SELECT count(*), count(DISTINCT session_date)
           FROM pitch_intel.trackman_pitches tp WHERE tp.link_id = l.id AND l.source = 'trackman'
         ORDER BY 1 DESC LIMIT 1
       ) p ON TRUE
       LEFT JOIN LATERAL (
         SELECT status, started_at, error FROM pitch_intel.pull_runs pr
          WHERE pr.link_id = l.id ORDER BY pr.started_at DESC LIMIT 1
       ) r ON TRUE
      ORDER BY a.name`,
  );
}

export async function getLink(id: number): Promise<Link | null> {
  const rows = await (await db()).query<Link>(
    `SELECT ${LINK_COLUMNS}
       FROM pitch_intel.athlete_source_links l
       JOIN analytics.d_athletes a ON a.athlete_uuid = l.athlete_uuid
      WHERE l.id = $1`,
    id,
  );
  return rows[0] ?? null;
}

export async function getEnabledLinks(source: Link["source"] = "savant"): Promise<Link[]> {
  return (await db()).query<Link>(
    `SELECT ${LINK_COLUMNS}
       FROM pitch_intel.athlete_source_links l
       JOIN analytics.d_athletes a ON a.athlete_uuid = l.athlete_uuid
      WHERE l.pull_enabled AND l.source = $1
      ORDER BY a.name`,
    source,
  );
}

/** Links whose athlete name, athlete uuid, Savant name or MLB ID matches. */
export async function findLinks(query: string): Promise<Link[]> {
  const q = query.trim();
  return (await db()).query<Link>(
    `SELECT ${LINK_COLUMNS}
       FROM pitch_intel.athlete_source_links l
       JOIN analytics.d_athletes a ON a.athlete_uuid = l.athlete_uuid
      WHERE l.athlete_uuid = $1 OR l.source_player_id = $1 OR l.id::text = $1
         OR a.name ILIKE '%' || $1 || '%' OR l.source_player_name ILIKE '%' || $1 || '%'
      ORDER BY a.name`,
    q,
  );
}

export async function linksForAthletes(athleteUuids: string[]): Promise<Array<{ athlete_uuid: string; source_player_name: string; source_player_id: string }>> {
  if (!athleteUuids.length) return [];
  return (await db()).query(
    `SELECT athlete_uuid, source_player_name, source_player_id
       FROM pitch_intel.athlete_source_links
      WHERE source = 'savant' AND athlete_uuid = ANY($1::text[])`,
    athleteUuids,
  );
}

export async function getLinkBySourceId(source: Link["source"], sourcePlayerId: string): Promise<Link | null> {
  const rows = await (await db()).query<Link>(
    `SELECT ${LINK_COLUMNS}
       FROM pitch_intel.athlete_source_links l
       JOIN analytics.d_athletes a ON a.athlete_uuid = l.athlete_uuid
      WHERE l.source = $1 AND l.source_player_id = $2`,
    source,
    sourcePlayerId,
  );
  return rows[0] ?? null;
}

export interface NewLink {
  athleteUuid: string;
  source: Link["source"];
  sourcePlayerId: string;
  sourcePlayerName: string;
  throws: "L" | "R" | null;
  level: string | null;
  league: string | null;
  backfillFrom: number;
  linkedBy: string | null;
}

export async function insertLink(link: NewLink): Promise<number> {
  const rows = await (await db()).query<{ id: number }>(
    `INSERT INTO pitch_intel.athlete_source_links
       (athlete_uuid, source, source_player_id, source_player_name, throws, level, league, backfill_from, linked_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id::int AS id`,
    link.athleteUuid,
    link.source,
    link.sourcePlayerId,
    link.sourcePlayerName,
    link.throws,
    link.level,
    link.league,
    link.backfillFrom,
    link.linkedBy,
  );
  return rows[0].id;
}

export async function setPullEnabled(id: number, enabled: boolean): Promise<void> {
  await (await db()).exec(`UPDATE pitch_intel.athlete_source_links SET pull_enabled = $2 WHERE id = $1`, id, enabled);
}

/** Records a successful pull: last_pulled_at = now, last_game_date only moves forward. */
export async function touchLink(id: number, lastGameDate: string | null): Promise<void> {
  await (await db()).exec(
    `UPDATE pitch_intel.athlete_source_links
        SET last_pulled_at = NOW(),
            last_game_date = GREATEST(last_game_date, $2::date)
      WHERE id = $1`,
    id,
    lastGameDate,
  );
}

/** Fills throws from the data if it wasn't known at link time. */
export async function fillThrowsIfMissing(id: number, throws: "L" | "R"): Promise<void> {
  await (await db()).exec(
    `UPDATE pitch_intel.athlete_source_links SET throws = $2 WHERE id = $1 AND throws IS NULL`,
    id,
    throws,
  );
}

// ---------------------------------------------------------------------------
// Pull runs
// ---------------------------------------------------------------------------

export async function startRun(args: {
  linkId: number | null;
  athleteUuid: string | null;
  trigger: RunTrigger;
  from: string | null;
  to: string | null;
}): Promise<number> {
  const rows = await (await db()).query<{ id: number }>(
    `INSERT INTO pitch_intel.pull_runs (link_id, athlete_uuid, trigger, date_from, date_to)
     VALUES ($1, $2, $3, $4::date, $5::date) RETURNING id::int AS id`,
    args.linkId,
    args.athleteUuid,
    args.trigger,
    args.from,
    args.to,
  );
  return rows[0].id;
}

export async function finishRun(
  id: number,
  r: { status: Exclude<RunStatus, "running">; fetched: number; inserted: number; updated: number; checks: object; error: string | null },
): Promise<void> {
  await (await db()).exec(
    `UPDATE pitch_intel.pull_runs
        SET status = $2, rows_fetched = $3, rows_inserted = $4, rows_updated = $5,
            checks = $6::jsonb, error = $7, finished_at = NOW()
      WHERE id = $1`,
    id,
    r.status,
    r.fetched,
    r.inserted,
    r.updated,
    JSON.stringify(r.checks),
    r.error,
  );
}

export async function recentRuns(limit = 25, linkId?: number): Promise<PullRun[]> {
  return (await db()).query<PullRun>(
    `SELECT r.id::int AS id, r.link_id::int AS link_id, r.athlete_uuid, a.name AS athlete_name, r.trigger,
            r.date_from::text AS date_from, r.date_to::text AS date_to, r.rows_fetched, r.rows_inserted,
            r.rows_updated, r.status, r.checks, r.error, r.started_at::text AS started_at,
            r.finished_at::text AS finished_at
       FROM pitch_intel.pull_runs r
       LEFT JOIN analytics.d_athletes a ON a.athlete_uuid = r.athlete_uuid
      WHERE ($2::bigint IS NULL OR r.link_id = $2)
      ORDER BY r.started_at DESC
      LIMIT $1::int`,
    limit,
    linkId ?? null,
  );
}

/** True if a nightly run started recently and never finished (another one is probably in flight). */
export async function nightlyInFlight(minutes: number): Promise<boolean> {
  const rows = await (await db()).query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pitch_intel.pull_runs
      WHERE trigger = 'nightly' AND status = 'running'
        AND started_at > NOW() - make_interval(mins => $1::int)`,
    minutes,
  );
  return (rows[0]?.n ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Pitches
// ---------------------------------------------------------------------------

const KEY_COLUMNS = new Set(["game_pk", "at_bat_number", "pitch_number"]);
const INSERT_COLUMNS = [
  ...SAVANT_COLUMNS.map(([name]) => name),
  "athlete_uuid",
  "link_id",
  "source_level",
  "raw_extra",
  "pull_run_id",
];
const q = (c: string) => `"${c}"`;

const UPSERT_SQL = `
  INSERT INTO pitch_intel.savant_pitches (${INSERT_COLUMNS.map(q).join(", ")}, updated_at)
  SELECT ${INSERT_COLUMNS.map(q).join(", ")}, NOW()
    FROM jsonb_populate_recordset(NULL::pitch_intel.savant_pitches, $1::jsonb)
  ON CONFLICT (game_pk, at_bat_number, pitch_number) DO UPDATE SET
    ${INSERT_COLUMNS.filter((c) => !KEY_COLUMNS.has(c)).map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(",\n    ")},
    updated_at = NOW()
  RETURNING (xmax = 0) AS inserted`;

export interface PitchContext {
  athleteUuid: string;
  linkId: number;
  sourceLevel: "mlb" | "minors" | "csv";
  pullRunId: number | null;
}

/** Inserts new pitches and overwrites existing ones on the pitch key. Rows must already be deduped. */
export async function upsertPitches(
  rows: Array<PitchRow & { __level?: PitchContext["sourceLevel"] }>,
  ctx: Omit<PitchContext, "sourceLevel"> & { defaultLevel: PitchContext["sourceLevel"] },
): Promise<{ inserted: number; updated: number }> {
  const conn = await db();
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE).map(({ __level, ...r }) => ({
      ...r,
      athlete_uuid: ctx.athleteUuid,
      link_id: ctx.linkId,
      source_level: __level ?? ctx.defaultLevel,
      pull_run_id: ctx.pullRunId,
    }));
    const result = await conn.query<{ inserted: boolean }>(UPSERT_SQL, JSON.stringify(chunk));
    for (const r of result) {
      if (r.inserted) inserted++;
      else updated++;
    }
  }
  return { inserted, updated };
}

/** Shared connection for the other pitch-intel modules (trackman, reports, sessions). */
export { db as getDb };
