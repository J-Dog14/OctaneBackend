/**
 * Program data for the coach suite's Program tab, read from the 8ctane App DB
 * snapshot (app_db_snapshot.*, refreshed by OctaneAiLayer `python -m src.main sync`
 * / scripts/run_app_db_sync.bat).
 *
 * Shape of the App DB (prisma/schema.prisma in the Octane repo):
 *   Program (userId, createdAt, endDate) → ProgramDay (programDayDate)
 *   Lifts:      ProgramDay.liftToProgramDayId → ExerciseToLift (per-day copy; reps[], weight[], completedSets[])
 *               and SuperSetsExercisesToProgramLifts → ExerciseToSuperSet (same fields)
 *   Prep / bulletproofing / movement enhancement: ProgramDay.prepId / bulletProofingId /
 *               movementEnhancementId → ExerciseTo* (prescription), with the day's log in
 *               *ActivityStatus (programDayId, completedSets[], weight[])
 *   Plyos / throwing are left out for now (throwing view comes later).
 *
 * Athlete link: d_athletes.app_db_uuid = User.id, or the same email.
 */

import { prisma } from "@/lib/db/prisma";
import { MUSCLE_IDS, isNonMuscleWork, musclesFor, normalizeExerciseName, parseDescriptionMuscles, type MuscleId, type MuscleMap, type MuscleSource } from "@/lib/coach/programMuscles";

export type WorkoutCategory = "lift" | "superset" | "prep" | "bulletproofing" | "movement";

export interface ProgramInfo {
  id: number;
  name: string;
  start: string;
  end: string | null;
  archived: boolean;
  type: string | null;
  /** Scheduled days with at least one exercise. */
  days: number;
}

export interface WorkoutEntry {
  date: string;
  programId: number;
  dayId: number;
  category: WorkoutCategory;
  exerciseId: number | null;
  name: string;
  type: string | null;
  repUnit: string | null;
  /** Prescribed sets (length of the reps array). */
  sets: number;
  /** Sets marked COMPLETED; null when the athlete never logged this exercise that day. */
  completed: number | null;
  reps: number[];
  /** Per-set weight: what the athlete logged where the app keeps a log (prep / bulletproofing / movement), else the program's. */
  weight: number[];
  /** Per-set weight as prescribed in the program. */
  rxWeight: number[];
  /** Per-set result: "done" / "missed", null where nothing was logged for that set. */
  setMarks: Array<"done" | "missed" | null>;
  /** Position within its block in the app (lifts and supersets share one sequence on a lift day). */
  order: number | null;
  /** Position inside its superset. */
  subOrder: number | null;
  /** Superset id: exercises with the same group are done together. */
  group: number | null;
  /** Coach's note on this exercise for the program. */
  notes: string | null;
  primary: MuscleId[];
  secondary: MuscleId[];
  muscleSource: MuscleSource;
}

export interface ProgramHistory {
  athlete: { athleteUuid: string; name: string };
  /** False when no 8ctane app account could be matched to this athlete. */
  linked: boolean;
  programs: ProgramInfo[];
  entries: WorkoutEntry[];
  /** When the snapshot's workout tables were last refreshed. */
  snapshotAt: string | null;
  /** Exercises with no muscles (no override, description, rule or type default), most frequent first. */
  unmapped: Array<{ name: string; type: string | null; count: number }>;
  /** Muscle words in exercise descriptions that aren't in DESCRIPTION_TERMS. */
  unknownTerms: Array<{ term: string; exercises: string[] }>;
  /** Exercise entries by where their muscles came from. */
  sourceCounts: Record<MuscleSource, number>;
  truncated: boolean;
}

const MAX_ENTRIES = 12_000;

type Row = {
  day_id: number;
  program_id: number;
  d: string;
  category: WorkoutCategory;
  exercise_id: number | null;
  name: string | null;
  type: string | null;
  rep_unit: string | null;
  description: string | null;
  reps: number[] | null;
  weight: number[] | null;
  rx_weight: number[] | null;
  completed_sets: string[] | null;
  logged: boolean;
  ord: number | null;
  sub: number | null;
  grp: number | null;
  notes: string | null;
};

export const S = (t: string) => `app_db_snapshot."${t}"`;

/** The 8ctane app accounts for an athlete ($1 = athlete_uuid): app_db_uuid link or same email. */
export const ATHLETE_USERS_SQL = `
    SELECT u."id" FROM ${S("User")} u, analytics.d_athletes a
    WHERE a.athlete_uuid = $1
      AND (u."id"::text = a.app_db_uuid OR (a.email IS NOT NULL AND a.email <> '' AND lower(u."email") = lower(a.email)))`;

export type AthletePrograms = { id: number; name: string; start: string; end: string | null; archived: boolean; type: string | null };

/** The athlete's programs, newest first; null when the snapshot doesn't exist yet. */
export async function loadAthletePrograms(athleteUuid: string): Promise<AthletePrograms[] | null> {
  try {
    return await prisma.$queryRawUnsafe<AthletePrograms[]>(
      `SELECT p."id"::int AS id, p."name" AS name, p."createdAt"::date::text AS start, p."endDate"::date::text AS "end",
              COALESCE(p."isArchived", false) AS archived, p."programType"::text AS type
       FROM ${S("Program")} p WHERE p."userId" IN (${ATHLETE_USERS_SQL})
       ORDER BY p."createdAt" DESC`,
      athleteUuid,
    );
  } catch (err) {
    if (isMissingRelation(err)) return null;
    throw err;
  }
}

/** Snapshot missing (never synced) or a table not added yet → treat as no data. */
export function isMissingRelation(err: unknown): boolean {
  return missing(err);
}

function missing(err: unknown): boolean {
  const msg = String(err);
  return msg.includes("does not exist") || msg.includes("42P01");
}

async function loadOverrides(): Promise<Map<string, MuscleMap>> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string; primary_muscles: string[]; secondary_muscles: string[] }>>(
      `SELECT exercise_name AS name, primary_muscles, secondary_muscles FROM coach.exercise_muscles`,
    );
    const valid = new Set<string>(MUSCLE_IDS);
    const keep = (xs: string[] | null) => (xs ?? []).filter((x): x is MuscleId => valid.has(x));
    return new Map(rows.map((r) => [normalizeExerciseName(r.name), { primary: keep(r.primary_muscles), secondary: keep(r.secondary_muscles) }]));
  } catch (err) {
    if (missing(err)) return new Map();
    throw err;
  }
}

export async function buildProgramHistory(athleteUuid: string): Promise<ProgramHistory | null> {
  const athlete = await prisma.d_athletes.findUnique({ where: { athlete_uuid: athleteUuid }, select: { name: true } });
  if (!athlete) return null;

  const userSql = ATHLETE_USERS_SQL;
  const found = await loadAthletePrograms(athleteUuid);
  if (found == null) return emptyHistory(athleteUuid, athlete.name, false);
  const programs = found;
  const linked = programs.length > 0 || (await isLinked(athleteUuid, userSql));
  if (!programs.length) return emptyHistory(athleteUuid, athlete.name, linked);

  const ids = programs.map((p) => p.id);
  // One row per exercise per scheduled day. `logged` = a log row exists / any set marked.
  const days = `
    SELECT pd."id" AS day_id, pd."programId" AS program_id, pd."programDayDate"::date AS d,
           pd."liftToProgramDayId" AS lift_day, pd."prepId" AS prep_id,
           pd."bulletProofingId" AS bp_id, pd."movementEnhancementId" AS me_id
    FROM ${S("ProgramDay")} pd
    WHERE pd."programId" = ANY($1::int[]) AND NOT COALESCE(pd."isArchived", false)`;
  const ex = `LEFT JOIN ${S("Exercise")} e ON e."id" = x."exerciseId"`;
  const cols = (completed: string, weight: string, logged: string, notes = "NULL::text", ord = `x."order"::int`, sub = "NULL::int", grp = "NULL::int") => `
           x."exerciseId"::int AS exercise_id, e."name" AS name, e."type"::text AS type, e."repUnit"::text AS rep_unit, e."description" AS description,
           x."reps"::int[] AS reps, ${weight} AS weight, x."weight"::int[] AS rx_weight, ${completed} AS completed_sets, ${logged} AS logged,
           ${ord} AS ord, ${sub} AS sub, ${grp} AS grp, ${notes} AS notes`;
  const sql = `
    WITH days AS (${days})
    SELECT dd.day_id, dd.program_id, dd.d::text AS d, 'lift' AS category,
           ${cols(`x."completedSets"::text[]`, `x."weight"::int[]`, `COALESCE(cardinality(x."completedSets"), 0) > 0`)}
    FROM days dd JOIN ${S("ExerciseToLift")} x ON x."liftToProgramDayId" = dd.lift_day ${ex}
    UNION ALL
    SELECT dd.day_id, dd.program_id, dd.d::text, 'superset',
           ${cols(`x."completedSets"::text[]`, `x."weight"::int[]`, `COALESCE(cardinality(x."completedSets"), 0) > 0`, `ss."notes"`, `ss."order"::int`, `x."order"::int`, `ss."id"::int`)}
    FROM days dd JOIN ${S("SuperSetsExercisesToProgramLifts")} ss ON ss."liftToProgramDayId" = dd.lift_day
    JOIN ${S("ExerciseToSuperSet")} x ON x."superSetId" = ss."id" ${ex}
    UNION ALL
    SELECT dd.day_id, dd.program_id, dd.d::text, 'prep',
           ${cols(`st."completedSets"::text[]`, `COALESCE(st."weight", x."weight")::int[]`, `st."id" IS NOT NULL`, `x."notes"`)}
    FROM days dd JOIN ${S("ExerciseToPrep")} x ON x."prepToProgramId" = dd.prep_id
    LEFT JOIN ${S("PrepActivityStatus")} st ON st."programDayId" = dd.day_id AND st."exerciseToPrepId" = x."id" ${ex}
    UNION ALL
    SELECT dd.day_id, dd.program_id, dd.d::text, 'bulletproofing',
           ${cols(`st."completedSets"::text[]`, `COALESCE(st."weight", x."weight")::int[]`, `st."id" IS NOT NULL`, `x."notes"`)}
    FROM days dd JOIN ${S("ExerciseToBulletProofing")} x ON x."BulletProofingToProgramId" = dd.bp_id
    LEFT JOIN ${S("BulletProofingActivityStatus")} st ON st."programDayId" = dd.day_id AND st."exerciseToBulletProofingId" = x."id" ${ex}
    UNION ALL
    SELECT dd.day_id, dd.program_id, dd.d::text, 'movement',
           ${cols(`st."completedSets"::text[]`, `COALESCE(st."weight", x."weight")::int[]`, `st."id" IS NOT NULL`, `x."notes"`)}
    FROM days dd JOIN ${S("ExerciseToMovementEnhancement")} x ON x."movementEnhancementToProgramId" = dd.me_id
    LEFT JOIN ${S("MovementEnhancementActivityStatus")} st ON st."programDayId" = dd.day_id AND st."exerciseToMovementEnhancementId" = x."id" ${ex}
    ORDER BY d DESC, day_id, category, ord NULLS LAST, sub NULLS LAST
    LIMIT ${MAX_ENTRIES + 1}`;

  let rows: Row[];
  try {
    rows = await prisma.$queryRawUnsafe<Row[]>(sql, ids);
  } catch (err) {
    // Older snapshot without the superset / activity-status tables: fall back to plain lifts.
    if (!missing(err)) throw err;
    rows = await prisma.$queryRawUnsafe<Row[]>(
      `WITH days AS (${days})
       SELECT dd.day_id, dd.program_id, dd.d::text AS d, 'lift' AS category,
              ${cols(`x."completedSets"::text[]`, `x."weight"::int[]`, `COALESCE(cardinality(x."completedSets"), 0) > 0`)}
       FROM days dd JOIN ${S("ExerciseToLift")} x ON x."liftToProgramDayId" = dd.lift_day ${ex}
       ORDER BY d DESC LIMIT ${MAX_ENTRIES + 1}`,
      ids,
    );
  }
  const truncated = rows.length > MAX_ENTRIES;
  if (truncated) rows = rows.slice(0, MAX_ENTRIES);

  const [overrides, snapshotAt] = await Promise.all([loadOverrides(), lastSnapshot()]);
  const unmapped = new Map<string, { name: string; type: string | null; count: number }>();
  const unknownTerms = new Map<string, Set<string>>();
  const sourceCounts: Record<MuscleSource, number> = { override: 0, description: 0, rule: 0, type: 0, none: 0 };
  const entries: WorkoutEntry[] = rows.map((r) => {
    const name = r.name ?? "(deleted exercise)";
    const { map, source } = musclesFor(name, r.type, overrides, r.description);
    sourceCounts[source] += 1;
    for (const t of parseDescriptionMuscles(r.description)?.unknown ?? []) {
      (unknownTerms.get(t.toLowerCase()) ?? unknownTerms.set(t.toLowerCase(), new Set()).get(t.toLowerCase())!).add(name);
    }
    if (source === "none" && r.type && !["PLYO", "HITTING_DRILL"].includes(r.type) && !isNonMuscleWork(name)) {
      const k = normalizeExerciseName(name);
      const u = unmapped.get(k) ?? { name, type: r.type, count: 0 };
      u.count += 1;
      unmapped.set(k, u);
    }
    const reps = (r.reps ?? []).map(Number);
    const marks = r.completed_sets ?? [];
    return {
      date: r.d,
      programId: r.program_id,
      dayId: r.day_id,
      category: r.category,
      exerciseId: r.exercise_id,
      name,
      type: r.type,
      repUnit: r.rep_unit,
      sets: Math.max(reps.length, marks.length),
      completed: r.logged ? marks.filter((m) => m === "COMPLETED").length : null,
      reps,
      weight: (r.weight ?? []).map(Number),
      rxWeight: (r.rx_weight ?? []).map(Number),
      setMarks: Array.from({ length: Math.max(reps.length, marks.length) }, (_, i) =>
        !r.logged || marks[i] == null ? null : marks[i] === "COMPLETED" ? "done" : "missed"),
      order: r.ord,
      subOrder: r.sub,
      group: r.grp,
      notes: r.notes?.trim() || null,
      primary: map.primary,
      secondary: map.secondary,
      muscleSource: source,
    };
  });

  const dayCount = new Map<number, Set<number>>();
  for (const e of entries) (dayCount.get(e.programId) ?? dayCount.set(e.programId, new Set()).get(e.programId)!).add(e.dayId);

  return {
    athlete: { athleteUuid, name: athlete.name },
    linked: true,
    programs: programs.map((p) => ({ ...p, days: dayCount.get(p.id)?.size ?? 0 })),
    entries,
    snapshotAt,
    unmapped: [...unmapped.values()].sort((a, b) => b.count - a.count).slice(0, 40),
    unknownTerms: [...unknownTerms.entries()].map(([term, ex]) => ({ term, exercises: [...ex].slice(0, 5) })),
    sourceCounts,
    truncated,
  };
}

export async function isLinked(athleteUuid: string, userSql: string = ATHLETE_USERS_SQL): Promise<boolean> {
  try {
    const r = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM (${userSql}) u`, athleteUuid);
    return (r[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

async function lastSnapshot(): Promise<string | null> {
  try {
    const r = await prisma.$queryRawUnsafe<Array<{ t: string | null }>>(
      `SELECT max(completed_at)::text AS t FROM ai_layer.sync_log
       WHERE sync_type = 'app_db_snapshot' AND status = 'success' AND table_name IN ('ExerciseToLift', 'ProgramDay')`,
    );
    return r[0]?.t ?? null;
  } catch {
    return null;
  }
}

function emptyHistory(athleteUuid: string, name: string, linked: boolean): ProgramHistory {
  return {
    athlete: { athleteUuid, name }, linked, programs: [], entries: [], snapshotAt: null, unmapped: [], unknownTerms: [],
    sourceCounts: { override: 0, description: 0, rule: 0, type: 0, none: 0 }, truncated: false,
  };
}

/** For the athlete header: program days up to tomorrow, split into lift and throwing work. */
export async function programSummary(athleteUuid: string): Promise<{ lift: number; throwing: number; lastLift: string | null; lastThrowing: string | null }> {
  const none = { lift: 0, throwing: 0, lastLift: null, lastThrowing: null };
  try {
    const r = await prisma.$queryRawUnsafe<Array<{ lift: number; throwing: number; last_lift: string | null; last_throwing: string | null }>>(
      `WITH d AS (
         SELECT pd.*, (pd."liftToProgramDayId" IS NOT NULL OR pd."prepId" IS NOT NULL OR pd."bulletProofingId" IS NOT NULL
                       OR pd."movementEnhancementId" IS NOT NULL) AS is_lift,
                (pd."appliedProgramPlyoId" IS NOT NULL OR pd."throwingActivityId" IS NOT NULL) AS is_throw
         FROM ${S("Program")} p JOIN ${S("ProgramDay")} pd ON pd."programId" = p."id"
         WHERE p."userId" IN (${ATHLETE_USERS_SQL}) AND NOT COALESCE(pd."isArchived", false)
           AND pd."programDayDate" <= now() + interval '1 day')
       SELECT count(*) FILTER (WHERE is_lift)::int AS lift, count(*) FILTER (WHERE is_throw)::int AS throwing,
              max("programDayDate") FILTER (WHERE is_lift)::date::text AS last_lift,
              max("programDayDate") FILTER (WHERE is_throw)::date::text AS last_throwing
       FROM d`,
      athleteUuid,
    );
    const x = r[0];
    return x ? { lift: x.lift, throwing: x.throwing, lastLift: x.last_lift, lastThrowing: x.last_throwing } : none;
  } catch (err) {
    if (missing(err)) return none;
    throw err;
  }
}
