import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/requireAuth";
import { badRequest, internalError, success } from "@/lib/responses";
import { musclesFor, normalizeExerciseName, type MuscleMap } from "@/lib/coach/programMuscles";
import { CSV_COLUMNS, csvEscape, readMappingCsv } from "@/lib/coach/exerciseMuscleCsv";

export const dynamic = "force-dynamic";

const ENSURE_TABLE = [
  `CREATE SCHEMA IF NOT EXISTS coach`,
  `CREATE TABLE IF NOT EXISTS coach.exercise_muscles (
     exercise_name TEXT PRIMARY KEY, primary_muscles TEXT[] NOT NULL DEFAULT '{}', secondary_muscles TEXT[] NOT NULL DEFAULT '{}',
     notes TEXT, updated_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
];

async function admin(): Promise<NextResponse | null> {
  try {
    await requireRole("admin");
    return null;
  } catch (e) {
    if (e instanceof Response) return e as NextResponse;
    throw e;
  }
}

async function overrides(): Promise<Map<string, MuscleMap & { notes: string | null }>> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ exercise_name: string; primary_muscles: string[]; secondary_muscles: string[]; notes: string | null }>>(
      `SELECT exercise_name, primary_muscles, secondary_muscles, notes FROM coach.exercise_muscles`,
    );
    return new Map(rows.map((r) => [normalizeExerciseName(r.exercise_name), { primary: r.primary_muscles as MuscleMap["primary"], secondary: r.secondary_muscles as MuscleMap["secondary"], notes: r.notes }]));
  } catch {
    return new Map();
  }
}

/**
 * GET /api/dashboard/program/exercise-muscles — CSV of every exercise in the
 * 8ctane app snapshot with its current muscles and where they come from.
 */
export async function GET() {
  const denied = await admin();
  if (denied) return denied;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string; type: string | null; n: number; description: string | null }>>(
      `WITH used AS (
         SELECT "exerciseId" AS id FROM app_db_snapshot."ExerciseToLift"
         UNION ALL SELECT "exerciseId" FROM app_db_snapshot."ExerciseToSuperSet"
         UNION ALL SELECT "exerciseId" FROM app_db_snapshot."ExerciseToPrep"
         UNION ALL SELECT "exerciseId" FROM app_db_snapshot."ExerciseToBulletProofing"
         UNION ALL SELECT "exerciseId" FROM app_db_snapshot."ExerciseToMovementEnhancement")
       SELECT min(e."name") AS name, mode() WITHIN GROUP (ORDER BY e."type"::text) AS type, count(u.id)::int AS n,
              max(e."description") FILTER (WHERE e."description" ~* 'primary muscles?[[:space:]]*:') AS description
       FROM app_db_snapshot."Exercise" e LEFT JOIN used u ON u.id = e."id"
       WHERE NOT COALESCE(e."isArchived", false) OR u.id IS NOT NULL
       GROUP BY lower(trim(e."name"))
       ORDER BY count(u.id) DESC, min(e."name")`,
    );
    const ov = await overrides();
    const lines = [CSV_COLUMNS.join(",")];
    for (const r of rows) {
      const o = ov.get(normalizeExerciseName(r.name));
      const { map, source } = musclesFor(r.name, r.type, ov, r.description);
      lines.push([r.name, r.type, r.n, map.primary.join(";") || (source === "override" ? "none" : ""), map.secondary.join(";"), source, o?.notes ?? ""].map(csvEscape).join(","));
    }
    return new NextResponse(lines.join("\r\n") + "\r\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="exercise-muscles-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    console.error("Error in GET /api/dashboard/program/exercise-muscles:", error);
    return internalError(String(error).includes("does not exist") ? "The 8ctane app snapshot hasn't been synced yet." : "Failed to export exercises");
  }
}

/** POST (CSV body or multipart "file") — upsert overrides into coach.exercise_muscles. */
export async function POST(request: NextRequest) {
  const denied = await admin();
  if (denied) return denied;
  let text: string;
  try {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const file = (await request.formData()).get("file");
      if (!file || typeof file === "string") return badRequest("Attach the CSV as 'file'.");
      text = await file.text();
    } else text = await request.text();
  } catch {
    return badRequest("Could not read the upload.");
  }
  if (text.length > 5_000_000) return badRequest("File too large (5 MB max).");
  const parsed = readMappingCsv(text);
  if (!parsed.rows.length) return badRequest(parsed.errors[0]?.message ?? "No rows with muscles to save.");

  let who: string | null = null;
  try {
    if (process.env.CLERK_SECRET_KEY && (await auth()).userId) who = (await currentUser())?.primaryEmailAddress?.emailAddress ?? null;
  } catch {
    who = null;
  }
  try {
    for (const sql of ENSURE_TABLE) await prisma.$executeRawUnsafe(sql);
    await prisma.$transaction(
      parsed.rows.map((r) =>
        prisma.$executeRawUnsafe(
          `INSERT INTO coach.exercise_muscles (exercise_name, primary_muscles, secondary_muscles, notes, updated_by, updated_at)
           VALUES ($1, $2::text[], $3::text[], $4, $5, now())
           ON CONFLICT (exercise_name) DO UPDATE SET primary_muscles = EXCLUDED.primary_muscles,
             secondary_muscles = EXCLUDED.secondary_muscles, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          r.name, r.primary, r.secondary, r.notes, who,
        ),
      ),
    );
    return success({ saved: parsed.rows.length, skipped: parsed.skipped, errors: parsed.errors });
  } catch (error) {
    console.error("Error in POST /api/dashboard/program/exercise-muscles:", error);
    return internalError("Failed to save the mapping");
  }
}
