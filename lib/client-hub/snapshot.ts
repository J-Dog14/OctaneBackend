/**
 * Reads the 8ctane App DB snapshot (app_db_snapshot.*, refreshed nightly and by the
 * coach "Sync database" button) for the Client Hub: every program with its user and
 * scheduled-day bounds, and the training calendar (check-offs) for a set of users.
 *
 * The snapshot mirrors the app's own schema, which this repo doesn't own, so the few
 * columns that may or may not exist (User name columns, Program.startDate, a program↔coach
 * table) are probed once per process instead of assumed.
 */

import { prisma } from '@/lib/db/prisma';
import { isMissingRelation, S } from '@/lib/coach/program';
import type { AppProgram, AppUser, CalendarActivity, CalendarDay } from './types';
import type { IsoDay } from './dates';
import type { ProgramType } from './constants';

interface Probe {
  userName: string; // SQL expression over alias u
  programStart: string | null; // column on alias p, when the app has one
  coachTable: { table: string; programCol: string; userCol: string } | null;
}

let probeCache: { at: number; value: Probe } | null = null;

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function probe(): Promise<Probe> {
  if (probeCache && Date.now() - probeCache.at < 10 * 60_000) return probeCache.value;
  const cols = await prisma.$queryRawUnsafe<Array<{ t: string; c: string }>>(
    `SELECT table_name AS t, column_name AS c FROM information_schema.columns
     WHERE table_schema = 'app_db_snapshot' AND (table_name IN ('User', 'Program') OR table_name ILIKE '%coach%')`,
  );
  const has = (t: string, c: string) => cols.some((r) => r.t === t && r.c === c);
  if (!cols.some((r) => r.t === 'Program')) throw new SnapshotMissingError();

  let userName = `u."email"`;
  if (has('User', 'firstName') && has('User', 'lastName')) {
    userName = `NULLIF(btrim(concat_ws(' ', u."firstName", u."lastName")), '')`;
    if (has('User', 'name')) userName = `COALESCE(${userName}, NULLIF(btrim(u."name"), ''))`;
  } else if (has('User', 'name')) {
    userName = `NULLIF(btrim(u."name"), '')`;
  }
  userName = `COALESCE(${userName}, u."email", 'Unknown')`;

  const programStart = ['startDate', 'programStartDate', 'start'].find((c) => has('Program', c)) ?? null;

  // A join table between programs and their coaches, e.g. ProgramCoach(programId, userId).
  let coachTable: Probe['coachTable'] = null;
  const coachTables = [...new Set(cols.filter((r) => /coach/i.test(r.t)).map((r) => r.t))];
  for (const t of coachTables) {
    const tc = cols.filter((r) => r.t === t).map((r) => r.c);
    const programCol = tc.find((c) => /^programId$/i.test(c));
    const userCol = tc.find((c) => /^(coachId|coachUserId|userId)$/i.test(c));
    if (programCol && userCol) {
      coachTable = { table: t, programCol, userCol };
      break;
    }
  }

  const value = { userName, programStart: programStart ? `p.${ident(programStart)}` : null, coachTable };
  probeCache = { at: Date.now(), value };
  return value;
}

export class SnapshotMissingError extends Error {
  constructor() {
    super('The 8ctane app snapshot has not been synced yet (app_db_snapshot.Program is missing). Run "Sync database" first.');
    this.name = 'SnapshotMissingError';
  }
}

const HAS_WORK = `(pd."liftToProgramDayId" IS NOT NULL OR pd."prepId" IS NOT NULL OR pd."bulletProofingId" IS NOT NULL
     OR pd."movementEnhancementId" IS NOT NULL OR pd."appliedProgramPlyoId" IS NOT NULL OR pd."throwingActivityId" IS NOT NULL)`;

type ProgramRow = {
  id: number;
  user_id: string;
  email: string | null;
  user_name: string;
  name: string | null;
  type: string | null;
  start: string | null;
  end: string | null;
  archived: boolean;
  first_day: string | null;
  last_day: string | null;
  coaches: string[] | null;
};

export function toProgramType(raw: string | null | undefined): ProgramType | null {
  if (!raw) return null;
  const t = raw.toUpperCase();
  if (t === 'REMOTE' || t === 'HYBRID' || t === 'IN_HOUSE') return t;
  return 'IN_HOUSE';
}

/** Every 8ctane app user who has (or had) a program, with all their programs. */
export async function loadAppUsers(): Promise<AppUser[]> {
  const p = await probe();
  const coachJoin = p.coachTable
    ? `LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT ${p.userName.replace(/\bu\./g, 'cu.')}) AS names
         FROM app_db_snapshot.${ident(p.coachTable.table)} pc
         JOIN ${S('User')} cu ON cu."id" = pc.${ident(p.coachTable.userCol)}
         WHERE pc.${ident(p.coachTable.programCol)} = p."id") co ON true`
    : '';
  let rows: ProgramRow[];
  try {
    rows = await prisma.$queryRawUnsafe<ProgramRow[]>(
      `WITH days AS (
         SELECT pd."programId" AS program_id, min(pd."programDayDate")::date AS first_day, max(pd."programDayDate")::date AS last_day
         FROM ${S('ProgramDay')} pd
         WHERE NOT COALESCE(pd."isArchived", false) AND ${HAS_WORK}
         GROUP BY 1)
       SELECT p."id"::int AS id, u."id"::text AS user_id, lower(btrim(u."email")) AS email, ${p.userName} AS user_name,
              p."name" AS name, p."programType"::text AS type,
              COALESCE(${p.programStart ? `${p.programStart}::date, ` : ''}d.first_day, p."createdAt"::date)::text AS start,
              p."endDate"::date::text AS "end", COALESCE(p."isArchived", false) AS archived,
              d.first_day::text AS first_day, d.last_day::text AS last_day,
              ${p.coachTable ? 'co.names' : 'NULL::text[]'} AS coaches
       FROM ${S('Program')} p
       JOIN ${S('User')} u ON u."id" = p."userId"
       LEFT JOIN days d ON d.program_id = p."id"
       ${coachJoin}
       ORDER BY u."id", p."id"`,
    );
  } catch (err) {
    if (isMissingRelation(err)) throw new SnapshotMissingError();
    throw err;
  }

  const users = new Map<string, AppUser>();
  for (const r of rows) {
    const user = users.get(r.user_id) ?? { id: r.user_id, email: r.email || null, name: r.user_name.trim(), programs: [] };
    users.set(r.user_id, user);
    const program: AppProgram = {
      id: r.id,
      userId: r.user_id,
      name: r.name,
      type: toProgramType(r.type),
      start: r.start,
      end: r.end,
      archived: r.archived,
      firstDay: r.first_day,
      lastDay: r.last_day,
      coaches: (r.coaches ?? []).filter(Boolean),
    };
    user.programs.push(program);
  }
  return [...users.values()];
}

type CalRow = { user_id: string; d: string; kind: string; name: string | null; planned: number | null; unknown: number | null; completed: number | null };

/**
 * Scheduled work for `userIds` between `from` and `to` (inclusive), grouped per user and day.
 * Archived programs and days are left out, as in the app. Returns null when the snapshot is
 * missing the workout tables.
 */
export async function loadCalendars(userIds: string[], from: IsoDay, to: IsoDay): Promise<Map<string, CalendarDay[]> | null> {
  if (!userIds.length) return new Map();
  const planned = `COALESCE(cardinality(x."reps"), 0)`;
  const done = (col: string) => `(SELECT count(*) FROM unnest(COALESCE(${col}::text[], '{}')) s WHERE s = 'COMPLETED')::int`;
  const sql = `
    WITH days AS (
      SELECT pd."id" AS day_id, p."userId"::text AS user_id, pd."programDayDate"::date AS d,
             pd."liftToProgramDayId" AS lift_day, pd."prepId" AS prep_id, pd."bulletProofingId" AS bp_id,
             pd."movementEnhancementId" AS me_id, pd."appliedProgramPlyoId" AS plyo_link, pd."throwingActivityId" AS ta_id
      FROM ${S('Program')} p JOIN ${S('ProgramDay')} pd ON pd."programId" = p."id"
      WHERE p."userId"::text = ANY($1::text[]) AND NOT COALESCE(p."isArchived", false) AND NOT COALESCE(pd."isArchived", false)
        AND pd."programDayDate" >= $2::date AND pd."programDayDate" < ($3::date + 1))
    SELECT dd.user_id, dd.d::text AS d, 'lift' AS kind, e."name" AS name, ${planned} AS planned,
           CASE WHEN COALESCE(cardinality(x."completedSets"), 0) = 0 THEN ${planned} ELSE 0 END AS unknown,
           ${done('x."completedSets"')} AS completed
    FROM days dd JOIN ${S('ExerciseToLift')} x ON x."liftToProgramDayId" = dd.lift_day
    LEFT JOIN ${S('Exercise')} e ON e."id" = x."exerciseId"
    UNION ALL
    SELECT dd.user_id, dd.d::text, 'lift', e."name", ${planned},
           CASE WHEN COALESCE(cardinality(x."completedSets"), 0) = 0 THEN ${planned} ELSE 0 END,
           ${done('x."completedSets"')}
    FROM days dd JOIN ${S('SuperSetsExercisesToProgramLifts')} ss ON ss."liftToProgramDayId" = dd.lift_day
    JOIN ${S('ExerciseToSuperSet')} x ON x."superSetId" = ss."id"
    LEFT JOIN ${S('Exercise')} e ON e."id" = x."exerciseId"
    UNION ALL
    SELECT dd.user_id, dd.d::text, 'prep', e."name", ${planned}, 0, ${done('st."completedSets"')}
    FROM days dd JOIN ${S('ExerciseToPrep')} x ON x."prepToProgramId" = dd.prep_id
    LEFT JOIN ${S('PrepActivityStatus')} st ON st."programDayId" = dd.day_id AND st."exerciseToPrepId" = x."id"
    LEFT JOIN ${S('Exercise')} e ON e."id" = x."exerciseId"
    UNION ALL
    SELECT dd.user_id, dd.d::text, 'bulletproofing', e."name", ${planned}, 0, ${done('st."completedSets"')}
    FROM days dd JOIN ${S('ExerciseToBulletProofing')} x ON x."BulletProofingToProgramId" = dd.bp_id
    LEFT JOIN ${S('BulletProofingActivityStatus')} st ON st."programDayId" = dd.day_id AND st."exerciseToBulletProofingId" = x."id"
    LEFT JOIN ${S('Exercise')} e ON e."id" = x."exerciseId"
    UNION ALL
    SELECT dd.user_id, dd.d::text, 'movement', e."name", ${planned}, 0, ${done('st."completedSets"')}
    FROM days dd JOIN ${S('ExerciseToMovementEnhancement')} x ON x."movementEnhancementToProgramId" = dd.me_id
    LEFT JOIN ${S('MovementEnhancementActivityStatus')} st ON st."programDayId" = dd.day_id AND st."exerciseToMovementEnhancementId" = x."id"
    LEFT JOIN ${S('Exercise')} e ON e."id" = x."exerciseId"
    UNION ALL
    SELECT dd.user_id, dd.d::text, 'plyo', pl."name", ${planned}, 0, ${done('st."completedSets"')}
    FROM days dd JOIN ${S('PlyoToProgram')} ptp ON ptp."id" = dd.plyo_link
    LEFT JOIN ${S('Plyo')} pl ON pl."id" = ptp."plyoId"
    LEFT JOIN ${S('ThrowingExerciseToPlyo')} x ON x."plyoToProgramId" = dd.plyo_link
    LEFT JOIN ${S('PlyoActivityStatus')} st ON st."programDayId" = dd.day_id AND st."throwingExerciseToPlyoId" = x."id"
    UNION ALL
    SELECT dd.user_id, dd.d::text, 'throwing', ta."name", NULL, NULL, NULL
    FROM days dd JOIN ${S('ThrowingActivity')} ta ON ta."id" = dd.ta_id`;

  let rows: CalRow[];
  try {
    rows = await prisma.$queryRawUnsafe<CalRow[]>(sql, userIds, from, to);
  } catch (err) {
    if (isMissingRelation(err)) return null;
    throw err;
  }

  const byUser = new Map<string, Map<IsoDay, CalendarActivity[]>>();
  for (const r of rows) {
    const days = byUser.get(r.user_id) ?? byUser.set(r.user_id, new Map()).get(r.user_id)!;
    const list = days.get(r.d) ?? days.set(r.d, []).get(r.d)!;
    list.push({
      kind: r.kind,
      name: r.name,
      completion: r.planned == null ? null : { plannedSets: Number(r.planned), unknownSets: Number(r.unknown ?? 0), completedSets: Number(r.completed ?? 0) },
    });
  }
  const out = new Map<string, CalendarDay[]>();
  for (const id of userIds) {
    const days = byUser.get(id);
    out.set(id, days ? [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, activities]) => ({ date, activities })) : []);
  }
  return out;
}

/** When the snapshot's program tables were last refreshed (ai_layer.sync_log), or null. */
export async function snapshotTime(): Promise<string | null> {
  try {
    const r = await prisma.$queryRawUnsafe<Array<{ t: string | null }>>(
      `SELECT max(completed_at)::text AS t FROM ai_layer.sync_log
       WHERE sync_type = 'app_db_snapshot' AND status = 'success' AND table_name IN ('Program', 'ProgramDay')`,
    );
    return r[0]?.t ?? null;
  } catch {
    return null;
  }
}
