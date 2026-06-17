import { requireAuth } from "@/lib/auth/requireAuth";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { internalError, success } from "@/lib/responses";

export async function POST() {
  await requireAuth();
  try {
    // Step 1: fill exact DOB from f_proteus.birth_date (stored as "YYYY-MM-DD" string).
    // Uses [0-9] instead of \d — Postgres POSIX regex does not support \d as a digit shorthand.
    const proteusCount = await prisma.$executeRawUnsafe(`
      UPDATE analytics.d_athletes a
      SET date_of_birth = p.birth_date::date, updated_at = NOW()
      FROM (
        SELECT DISTINCT ON (athlete_uuid) athlete_uuid, birth_date
        FROM public.f_proteus
        WHERE birth_date IS NOT NULL AND birth_date != ''
          AND birth_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        ORDER BY athlete_uuid, session_date DESC
      ) p
      WHERE a.athlete_uuid = p.athlete_uuid
        AND a.date_of_birth IS NULL
    `);

    // Step 2: approximate DOB from age_at_collection + session_date for remaining athletes.
    // Priority: athletic screen CMJ → readiness screen → pitching kinematics → hitting kinematics → mobility.
    // Inner alias a2 avoids ambiguity with the outer UPDATE target a.
    // Sanity check: result must be between 1950 and (today - 10 years).
    const approxCount = await prisma.$executeRawUnsafe(`
      UPDATE analytics.d_athletes a
      SET date_of_birth = src.estimated_dob, updated_at = NOW()
      FROM (
        SELECT a2.athlete_uuid,
          COALESCE(
            (SELECT (s.session_date - (s.age_at_collection * INTERVAL '365 days 6 hours'))::date
             FROM public.f_athletic_screen_cmj s
             WHERE s.athlete_uuid = a2.athlete_uuid AND s.age_at_collection IS NOT NULL
             ORDER BY s.session_date DESC LIMIT 1),
            (SELECT (s.session_date - (s.age_at_collection * INTERVAL '365 days 6 hours'))::date
             FROM public.f_readiness_screen s
             WHERE s.athlete_uuid = a2.athlete_uuid AND s.age_at_collection IS NOT NULL
             ORDER BY s.session_date DESC LIMIT 1),
            (SELECT (s.session_date - (s.age_at_collection * INTERVAL '365 days 6 hours'))::date
             FROM public.f_kinematics_pitching s
             WHERE s.athlete_uuid = a2.athlete_uuid AND s.age_at_collection IS NOT NULL
             ORDER BY s.session_date DESC LIMIT 1),
            (SELECT (s.session_date - (s.age_at_collection * INTERVAL '365 days 6 hours'))::date
             FROM public.f_kinematics_hitting s
             WHERE s.athlete_uuid = a2.athlete_uuid AND s.age_at_collection IS NOT NULL
             ORDER BY s.session_date DESC LIMIT 1),
            (SELECT (s.session_date - (s.age_at_collection * INTERVAL '365 days 6 hours'))::date
             FROM public.f_mobility s
             WHERE s.athlete_uuid = a2.athlete_uuid AND s.age_at_collection IS NOT NULL
             ORDER BY s.session_date DESC LIMIT 1)
          ) AS estimated_dob
        FROM analytics.d_athletes a2
        WHERE a2.date_of_birth IS NULL
      ) src
      WHERE a.athlete_uuid = src.athlete_uuid
        AND src.estimated_dob IS NOT NULL
        AND src.estimated_dob > '1950-01-01'
        AND src.estimated_dob < CURRENT_DATE - INTERVAL '10 years'
    `);

    const totalUpdated = proteusCount + approxCount;

    try {
      await prisma.auditLog.create({
        data: {
          duration_ms: 0,
          triggered_by: "fix-dob",
          critical_count: 0,
          warning_count: 0,
          info_count: 0,
          report_json: {
            action: "fix-dob",
            updated: totalUpdated,
            method_breakdown: { proteus: proteusCount, approximated: approxCount },
          } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (logErr) {
      console.error("Failed to write audit log for fix-dob:", logErr);
    }

    return success({
      ok: true,
      updated: totalUpdated,
      method_breakdown: { proteus: proteusCount, approximated: approxCount },
      message: `Updated ${totalUpdated} athlete(s): ${proteusCount} from Proteus records, ${approxCount} approximated from age + session date.`,
    });
  } catch (error) {
    console.error("Error in POST /api/dashboard/audit/fix-dob:", error);
    return internalError("Failed to backfill date of birth");
  }
}
