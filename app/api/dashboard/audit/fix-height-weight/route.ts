import { requireAuth } from "@/lib/auth/requireAuth";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { internalError, success } from "@/lib/responses";

// Unit detection (applied as SQL CASE expressions):
//   Height: 50–90   → inches (keep). 91–250 → cm (÷ 2.54). Outside → skip.
//   Weight: > 80    → lbs (keep). 30–80 → kg (× 2.205). Outside → skip.
// Priority: f_pro_sup (assumed imperial) → f_pitching_trials → f_hitting_trials
// Inner alias a2 avoids ambiguity with the outer UPDATE target a.

export async function POST() {
  await requireAuth();
  try {
    const updated = await prisma.$executeRawUnsafe(`
      UPDATE analytics.d_athletes a
      SET
        height = COALESCE(a.height, src.height_in),
        weight = COALESCE(a.weight, src.weight_lbs),
        updated_at = NOW()
      FROM (
        SELECT a2.athlete_uuid,
          COALESCE(
            (SELECT CASE
               WHEN ps.height BETWEEN 50 AND 90  THEN ps.height
               WHEN ps.height BETWEEN 91 AND 250 THEN ROUND((ps.height / 2.54)::numeric, 1)
               ELSE NULL
             END
             FROM public.f_pro_sup ps
             WHERE ps.athlete_uuid = a2.athlete_uuid AND ps.height IS NOT NULL
             ORDER BY ps.session_date DESC LIMIT 1),
            (SELECT CASE
               WHEN pt.height BETWEEN 50 AND 90  THEN pt.height
               WHEN pt.height BETWEEN 91 AND 250 THEN ROUND((pt.height / 2.54)::numeric, 1)
               ELSE NULL
             END
             FROM public.f_pitching_trials pt
             WHERE pt.athlete_uuid = a2.athlete_uuid AND pt.height IS NOT NULL
             ORDER BY pt.session_date DESC LIMIT 1),
            (SELECT CASE
               WHEN ht.height BETWEEN 50 AND 90  THEN ht.height
               WHEN ht.height BETWEEN 91 AND 250 THEN ROUND((ht.height / 2.54)::numeric, 1)
               ELSE NULL
             END
             FROM public.f_hitting_trials ht
             WHERE ht.athlete_uuid = a2.athlete_uuid AND ht.height IS NOT NULL
             ORDER BY ht.session_date DESC LIMIT 1)
          ) AS height_in,
          COALESCE(
            (SELECT CASE
               WHEN ps.weight > 80              THEN ps.weight
               WHEN ps.weight BETWEEN 30 AND 80 THEN ROUND((ps.weight * 2.205)::numeric, 1)
               ELSE NULL
             END
             FROM public.f_pro_sup ps
             WHERE ps.athlete_uuid = a2.athlete_uuid AND ps.weight IS NOT NULL
             ORDER BY ps.session_date DESC LIMIT 1),
            (SELECT CASE
               WHEN pt.weight > 80              THEN pt.weight
               WHEN pt.weight BETWEEN 30 AND 80 THEN ROUND((pt.weight * 2.205)::numeric, 1)
               ELSE NULL
             END
             FROM public.f_pitching_trials pt
             WHERE pt.athlete_uuid = a2.athlete_uuid AND pt.weight IS NOT NULL
             ORDER BY pt.session_date DESC LIMIT 1),
            (SELECT CASE
               WHEN ht.weight > 80              THEN ht.weight
               WHEN ht.weight BETWEEN 30 AND 80 THEN ROUND((ht.weight * 2.205)::numeric, 1)
               ELSE NULL
             END
             FROM public.f_hitting_trials ht
             WHERE ht.athlete_uuid = a2.athlete_uuid AND ht.weight IS NOT NULL
             ORDER BY ht.session_date DESC LIMIT 1)
          ) AS weight_lbs
        FROM analytics.d_athletes a2
        WHERE a2.height IS NULL OR a2.weight IS NULL
      ) src
      WHERE a.athlete_uuid = src.athlete_uuid
        AND (src.height_in IS NOT NULL OR src.weight_lbs IS NOT NULL)
    `);

    try {
      await prisma.auditLog.create({
        data: {
          duration_ms: 0,
          triggered_by: "fix-height-weight",
          critical_count: 0,
          warning_count: 0,
          info_count: 0,
          report_json: {
            action: "fix-height-weight",
            updated,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (logErr) {
      console.error("Failed to write audit log for fix-height-weight:", logErr);
    }

    return success({
      ok: true,
      updated,
      message: `Updated height/weight for ${updated} athlete(s). Values normalized to inches and lbs.`,
    });
  } catch (error) {
    console.error("Error in POST /api/dashboard/audit/fix-height-weight:", error);
    return internalError("Failed to backfill height/weight");
  }
}
