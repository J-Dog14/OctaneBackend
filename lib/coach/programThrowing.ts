/**
 * Program Throwing tab data: per scheduled day, the plyo routine (drills, reps,
 * ball weight, logged sets) and the throwing activity, from the App DB snapshot.
 *
 *   ProgramDay.appliedProgramPlyoId → PlyoToProgram → Plyo (name, intensity rank)
 *                                   → ThrowingExerciseToPlyo (drill = Exercise, reps[], plyoBallWeight)
 *                                     + PlyoActivityStatus (programDayId) = that day's log
 *   ProgramDay.throwingActivityId   → ThrowingActivity (name, description, intentClassification)
 *
 * The App DB has no pitch count or intensity number on a throwing activity, so
 * volume and intensity are estimated here (see estimateThrowing / dayLoad) — a
 * coach-facing rule set that can be tuned without touching the data.
 */

import { prisma } from "@/lib/db/prisma";
import { ATHLETE_USERS_SQL, S, isLinked, isMissingRelation, loadAthletePrograms, type AthletePrograms } from "@/lib/coach/program";

export interface PlyoDrill {
  name: string;
  reps: number[];
  /** "3 oz" … "32 oz", null when not set. */
  ball: string | null;
  /** Sets marked COMPLETED that day; null when not logged. */
  completed: number | null;
}

export interface ThrowingDay {
  date: string;
  programId: number;
  plyo: { name: string; intensity: number | null; drills: PlyoDrill[] } | null;
  throwing: {
    name: string;
    description: string | null;
    intent: "HIGH" | "NOT_HIGH" | "UNCLASSIFIED";
    /** Pitches/throws read from the activity name or description ("Pen Day 25 pitches"). */
    count: number | null;
  } | null;
  /** Plyo throws (sum of reps) + throwing count when known. */
  volume: number;
  /** 0-100 estimate: throwing intent / type, or the plyo routine's intensity rank. */
  intensity: number;
  intensityLabel: string;
}

export interface ThrowingHistory {
  athlete: { athleteUuid: string; name: string };
  linked: boolean;
  programs: Array<AthletePrograms & { days: number }>;
  days: ThrowingDay[];
  /** Highest plyo intensity rank in the athlete's plyo library (to scale ranks). */
  maxPlyoIntensity: number;
  snapshotAt: string | null;
}

const BALL: Record<string, string> = { OZ_3: "3 oz", OZ_5: "5 oz", OZ_7: "7 oz", OZ_16: "16 oz", OZ_32: "32 oz" };

/** Pitch/throw count written into an activity name or description. */
export function parseThrowCount(...texts: Array<string | null | undefined>): number | null {
  for (const t of texts) {
    if (!t) continue;
    const m = t.match(/(\d{1,3})\s*(?:-?\s*)(?:pitch(?:es)?|throws?|p\b|pc\b)/i) ?? t.match(/(?:pitch(?:es)?|throws?)\s*[:x-]?\s*(\d{1,3})/i);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Throwing intensity (0-100) from intent, then the activity's wording. */
export function estimateThrowing(name: string, description: string | null, intent: string): { intensity: number; label: string } {
  const t = `${name} ${description ?? ""}`.toLowerCase();
  if (/\b(game|start|live|sim(ulated)?\s*game|\bsim\b|scrimmage)/.test(t)) return { intensity: 95, label: "Game / live" };
  if (/\b(pulldown|max|velo|velocity|compete)/.test(t)) return { intensity: 90, label: "Max intent" };
  if (/\b(pen|bullpen|mound)/.test(t)) return { intensity: intent === "NOT_HIGH" ? 65 : 80, label: intent === "NOT_HIGH" ? "Light pen" : "Bullpen" };
  if (intent === "HIGH") return { intensity: 85, label: "High intent" };
  if (/\b(long toss|extended)/.test(t)) return { intensity: 60, label: "Long toss" };
  if (/\b(flat ?ground|flat)/.test(t)) return { intensity: 55, label: "Flat ground" };
  if (/\b(recovery|light|catch|catch play|throw program|hybrid|j-?band only)/.test(t)) return { intensity: 35, label: "Recovery / catch" };
  if (intent === "NOT_HIGH") return { intensity: 45, label: "Low intent" };
  return { intensity: 50, label: "Throwing" };
}

type DayRow = {
  day_id: number; program_id: number; d: string; plyo_link: number | null;
  plyo_name: string | null; plyo_intensity: number | null;
  ta_name: string | null; ta_description: string | null; ta_intent: string | null;
};
type DrillRow = { day_id: number; name: string | null; reps: number[] | null; ball: string | null; completed_sets: string[] | null; logged: boolean };

export async function buildThrowingHistory(athleteUuid: string): Promise<ThrowingHistory | null> {
  const athlete = await prisma.d_athletes.findUnique({ where: { athlete_uuid: athleteUuid }, select: { name: true } });
  if (!athlete) return null;
  const empty = (linked: boolean): ThrowingHistory => ({
    athlete: { athleteUuid, name: athlete.name }, linked, programs: [], days: [], maxPlyoIntensity: 5, snapshotAt: null,
  });
  const programs = await loadAthletePrograms(athleteUuid);
  if (programs == null) return empty(false);
  if (!programs.length) return empty(await isLinked(athleteUuid));
  const ids = programs.map((p) => p.id);

  const days = `
    SELECT pd."id" AS day_id, pd."programId" AS program_id, pd."programDayDate"::date AS d,
           pd."appliedProgramPlyoId" AS plyo_link, pd."throwingActivityId" AS ta_id
    FROM ${S("ProgramDay")} pd
    WHERE pd."programId" = ANY($1::int[]) AND NOT COALESCE(pd."isArchived", false)
      AND (pd."appliedProgramPlyoId" IS NOT NULL OR pd."throwingActivityId" IS NOT NULL)`;
  let dayRows: DayRow[];
  let drillRows: DrillRow[];
  try {
    [dayRows, drillRows] = await Promise.all([
      prisma.$queryRawUnsafe<DayRow[]>(
        `WITH days AS (${days})
         SELECT dd.day_id, dd.program_id, dd.d::text AS d, dd.plyo_link,
                pl."name" AS plyo_name, pl."intensity"::int AS plyo_intensity,
                ta."name" AS ta_name, ta."description" AS ta_description, ta."intentClassification"::text AS ta_intent
         FROM days dd
         LEFT JOIN ${S("PlyoToProgram")} ptp ON ptp."id" = dd.plyo_link
         LEFT JOIN ${S("Plyo")} pl ON pl."id" = ptp."plyoId"
         LEFT JOIN ${S("ThrowingActivity")} ta ON ta."id" = dd.ta_id
         ORDER BY dd.d DESC`,
        ids,
      ),
      prisma.$queryRawUnsafe<DrillRow[]>(
        `WITH days AS (${days})
         SELECT dd.day_id, e."name" AS name, x."reps"::int[] AS reps, x."plyoBallWeight"::text AS ball,
                st."completedSets"::text[] AS completed_sets, (st."id" IS NOT NULL) AS logged
         FROM days dd
         JOIN ${S("ThrowingExerciseToPlyo")} x ON x."plyoToProgramId" = dd.plyo_link
         LEFT JOIN ${S("Exercise")} e ON e."id" = x."throwingExerciseId"
         LEFT JOIN ${S("PlyoActivityStatus")} st ON st."programDayId" = dd.day_id AND st."throwingExerciseToPlyoId" = x."id"
         ORDER BY dd.day_id, x."order", x."id"`,
        ids,
      ),
    ]);
  } catch (err) {
    if (isMissingRelation(err)) return empty(true);
    throw err;
  }

  const [maxRank, snapshotAt] = await Promise.all([maxPlyoIntensity(athleteUuid), lastSnapshot()]);
  const drillsByDay = new Map<number, PlyoDrill[]>();
  for (const r of drillRows) {
    const reps = (r.reps ?? []).map(Number);
    const marks = r.completed_sets ?? [];
    const list = drillsByDay.get(r.day_id) ?? drillsByDay.set(r.day_id, []).get(r.day_id)!;
    list.push({ name: r.name ?? "(deleted drill)", reps, ball: r.ball ? (BALL[r.ball] ?? r.ball) : null, completed: r.logged ? marks.filter((m) => m === "COMPLETED").length : null });
  }

  const out: ThrowingDay[] = dayRows.map((r) => {
    const drills = drillsByDay.get(r.day_id) ?? [];
    const plyo = r.plyo_link != null ? { name: r.plyo_name ?? "Plyos", intensity: r.plyo_intensity, drills } : null;
    const throwing = r.ta_name
      ? { name: r.ta_name, description: r.ta_description, intent: (r.ta_intent ?? "UNCLASSIFIED") as "HIGH" | "NOT_HIGH" | "UNCLASSIFIED", count: parseThrowCount(r.ta_name, r.ta_description) }
      : null;
    const plyoThrows = drills.reduce((a, d) => a + d.reps.reduce((x, y) => x + y, 0), 0);
    const volume = plyoThrows + (throwing?.count ?? 0);
    const t = throwing ? estimateThrowing(throwing.name, throwing.description, throwing.intent) : null;
    // Plyo routines top out below a bullpen: rank / max rank → 15-60.
    const p = plyo ? { intensity: plyo.intensity != null ? Math.round(15 + (45 * plyo.intensity) / Math.max(1, maxRank)) : 30, label: plyo.name } : null;
    const best = [t, p].filter((x): x is { intensity: number; label: string } => !!x).sort((a, b) => b.intensity - a.intensity)[0];
    return {
      date: r.d, programId: r.program_id, plyo, throwing, volume,
      intensity: best?.intensity ?? 0, intensityLabel: best?.label ?? "Off",
    };
  });

  const dayCount = new Map<number, number>();
  for (const d of out) dayCount.set(d.programId, (dayCount.get(d.programId) ?? 0) + 1);
  return {
    athlete: { athleteUuid, name: athlete.name },
    linked: true,
    programs: programs.map((p) => ({ ...p, days: dayCount.get(p.id) ?? 0 })),
    days: out,
    maxPlyoIntensity: maxRank,
    snapshotAt,
  };
}

async function maxPlyoIntensity(athleteUuid: string): Promise<number> {
  try {
    const r = await prisma.$queryRawUnsafe<Array<{ m: number | null }>>(
      `SELECT max(pl."intensity")::int AS m
       FROM ${S("Program")} p JOIN ${S("PlyoToProgram")} ptp ON ptp."programId" = p."id" JOIN ${S("Plyo")} pl ON pl."id" = ptp."plyoId"
       WHERE p."userId" IN (${ATHLETE_USERS_SQL})`,
      athleteUuid,
    );
    return r[0]?.m ?? 5;
  } catch {
    return 5;
  }
}

async function lastSnapshot(): Promise<string | null> {
  try {
    const r = await prisma.$queryRawUnsafe<Array<{ t: string | null }>>(
      `SELECT max(completed_at)::text AS t FROM ai_layer.sync_log
       WHERE sync_type = 'app_db_snapshot' AND status = 'success' AND table_name IN ('ProgramDay', 'PlyoActivityStatus', 'ExerciseToLift')`,
    );
    return r[0]?.t ?? null;
  } catch {
    return null;
  }
}
