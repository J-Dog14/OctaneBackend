import { requireAuth } from "@/lib/auth/requireAuth";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { success } from "@/lib/responses";

export type AuditSeverity = "critical" | "warning" | "info";

export type AuditCheck = {
  id: string;
  label: string;
  severity: AuditSeverity;
  count: number;
  rows: Record<string, unknown>[];
  autoFixable: boolean;
  fixEndpoint?: string;
};

export type AuditReport = {
  runAt: string;
  durationMs: number;
  checks: AuditCheck[];
  summary: { critical: number; warning: number; info: number };
};

// ---------------------------------------------------------------------------
// SQL checks
// ---------------------------------------------------------------------------

const CHECKS: Array<{
  id: string;
  label: string;
  severity: AuditSeverity;
  autoFixable: boolean;
  fixEndpoint?: string;
  sql: string;
}> = [
  // ── Tier 1: Critical ────────────────────────────────────────────────────
  {
    id: "missing_octane_link",
    label: "Athletes with email + data but no Octane UUID",
    severity: "critical",
    autoFixable: false,
    sql: `
      SELECT athlete_uuid::text, name, email, updated_at
      FROM analytics.d_athletes
      WHERE email IS NOT NULL AND email != ''
        AND app_db_uuid IS NULL
        AND (
          has_pitching_data OR has_hitting_data OR has_athletic_screen_data
          OR has_readiness_screen_data OR has_pro_sup_data OR has_arm_action_data
          OR has_curveball_test_data OR has_mobility_data OR has_proteus_data
        )
      ORDER BY updated_at DESC
      LIMIT 50
    `,
  },
  {
    id: "stale_data_flags",
    label: "has_*_data flags out of sync with fact tables",
    severity: "critical",
    autoFixable: true,
    fixEndpoint: "/api/dashboard/audit/fix-flags",
    sql: `
      SELECT a.athlete_uuid::text, a.name,
        a.has_pitching_data        AS flag_pitching,
        a.has_hitting_data         AS flag_hitting,
        a.has_readiness_screen_data AS flag_readiness,
        a.has_athletic_screen_data AS flag_athletic,
        a.has_mobility_data        AS flag_mobility,
        EXISTS (SELECT 1 FROM public.f_kinematics_pitching p WHERE p.athlete_uuid = a.athlete_uuid)
          AS has_pitching_rows,
        EXISTS (SELECT 1 FROM public.f_kinematics_hitting h WHERE h.athlete_uuid = a.athlete_uuid)
          AS has_hitting_rows,
        EXISTS (SELECT 1 FROM public.f_readiness_screen rs WHERE rs.athlete_uuid = a.athlete_uuid)
          AS has_readiness_rows,
        (
          EXISTS (SELECT 1 FROM public.f_athletic_screen s WHERE s.athlete_uuid = a.athlete_uuid)
          OR EXISTS (SELECT 1 FROM public.f_athletic_screen_cmj s WHERE s.athlete_uuid = a.athlete_uuid)
          OR EXISTS (SELECT 1 FROM public.f_athletic_screen_dj s WHERE s.athlete_uuid = a.athlete_uuid)
          OR EXISTS (SELECT 1 FROM public.f_athletic_screen_slv s WHERE s.athlete_uuid = a.athlete_uuid)
          OR EXISTS (SELECT 1 FROM public.f_athletic_screen_nmt s WHERE s.athlete_uuid = a.athlete_uuid)
          OR EXISTS (SELECT 1 FROM public.f_athletic_screen_ppu s WHERE s.athlete_uuid = a.athlete_uuid)
        ) AS has_athletic_rows,
        EXISTS (SELECT 1 FROM public.f_mobility m WHERE m.athlete_uuid = a.athlete_uuid)
          AS has_mobility_rows
      FROM analytics.d_athletes a
      WHERE
        a.has_pitching_data != (
          EXISTS (SELECT 1 FROM public.f_kinematics_pitching p WHERE p.athlete_uuid = a.athlete_uuid)
        )
        OR a.has_hitting_data != (
          EXISTS (SELECT 1 FROM public.f_kinematics_hitting h WHERE h.athlete_uuid = a.athlete_uuid)
        )
        OR a.has_readiness_screen_data != (
          EXISTS (SELECT 1 FROM public.f_readiness_screen rs WHERE rs.athlete_uuid = a.athlete_uuid)
        )
        OR a.has_athletic_screen_data != (
          EXISTS (SELECT 1 FROM public.f_athletic_screen s WHERE s.athlete_uuid = a.athlete_uuid)
          OR EXISTS (SELECT 1 FROM public.f_athletic_screen_cmj s WHERE s.athlete_uuid = a.athlete_uuid)
          OR EXISTS (SELECT 1 FROM public.f_athletic_screen_dj s WHERE s.athlete_uuid = a.athlete_uuid)
          OR EXISTS (SELECT 1 FROM public.f_athletic_screen_slv s WHERE s.athlete_uuid = a.athlete_uuid)
          OR EXISTS (SELECT 1 FROM public.f_athletic_screen_nmt s WHERE s.athlete_uuid = a.athlete_uuid)
          OR EXISTS (SELECT 1 FROM public.f_athletic_screen_ppu s WHERE s.athlete_uuid = a.athlete_uuid)
        )
        OR a.has_mobility_data != (
          EXISTS (SELECT 1 FROM public.f_mobility mo WHERE mo.athlete_uuid = a.athlete_uuid)
        )
      LIMIT 50
    `,
  },
  {
    id: "stale_session_counts",
    label: "Session counts out of sync with fact tables",
    severity: "critical",
    autoFixable: true,
    fixEndpoint: "/api/dashboard/audit/fix-flags",
    sql: `
      SELECT a.athlete_uuid::text, a.name,
        a.pitching_session_count        AS stored_pitching,
        COUNT(DISTINCT pt.session_date) AS actual_pitching,
        a.hitting_session_count         AS stored_hitting,
        COUNT(DISTINCT ht.session_date) AS actual_hitting,
        a.readiness_screen_session_count AS stored_readiness,
        COUNT(DISTINCT rs.session_date) AS actual_readiness
      FROM analytics.d_athletes a
      LEFT JOIN public.f_kinematics_pitching pt ON pt.athlete_uuid = a.athlete_uuid
      LEFT JOIN public.f_kinematics_hitting ht ON ht.athlete_uuid = a.athlete_uuid
      LEFT JOIN public.f_readiness_screen rs ON rs.athlete_uuid = a.athlete_uuid
      GROUP BY a.athlete_uuid, a.name,
        a.pitching_session_count, a.hitting_session_count, a.readiness_screen_session_count
      HAVING
        a.pitching_session_count IS DISTINCT FROM COUNT(DISTINCT pt.session_date)
        OR a.hitting_session_count IS DISTINCT FROM COUNT(DISTINCT ht.session_date)
        OR a.readiness_screen_session_count IS DISTINCT FROM COUNT(DISTINCT rs.session_date)
      LIMIT 50
    `,
  },

  // ── Tier 2: Warnings ────────────────────────────────────────────────────
  {
    id: "missing_dob",
    label: "Athletes created in last 180 days with no date of birth",
    severity: "warning",
    autoFixable: true,
    fixEndpoint: "/api/dashboard/audit/fix-dob",
    sql: `
      SELECT athlete_uuid::text, name, email,
        (CASE WHEN has_pitching_data THEN 1 ELSE 0 END
         + CASE WHEN has_hitting_data THEN 1 ELSE 0 END
         + CASE WHEN has_athletic_screen_data THEN 1 ELSE 0 END
         + CASE WHEN has_readiness_screen_data THEN 1 ELSE 0 END
         + CASE WHEN has_mobility_data THEN 1 ELSE 0 END
         + CASE WHEN has_pro_sup_data THEN 1 ELSE 0 END
         + CASE WHEN has_arm_action_data THEN 1 ELSE 0 END
         + CASE WHEN has_proteus_data THEN 1 ELSE 0 END
        ) AS domain_count
      FROM analytics.d_athletes
      WHERE date_of_birth IS NULL
        AND created_at >= CURRENT_DATE - INTERVAL '180 days'
        AND (
          has_pitching_data OR has_hitting_data OR has_athletic_screen_data
          OR has_readiness_screen_data OR has_mobility_data OR has_pro_sup_data
          OR has_arm_action_data OR has_proteus_data
        )
      ORDER BY domain_count DESC, name
      LIMIT 50
    `,
  },
  {
    id: "missing_demographics",
    label: "Athletes created in last 180 days with no gender",
    severity: "warning",
    autoFixable: false,
    sql: `
      SELECT athlete_uuid::text, name, email
      FROM analytics.d_athletes
      WHERE gender IS NULL
        AND created_at >= CURRENT_DATE - INTERVAL '180 days'
        AND (has_athletic_screen_data OR has_pitching_data OR has_arm_action_data)
      ORDER BY name
      LIMIT 50
    `,
  },
  {
    id: "missing_email",
    label: "Athletes created in last 180 days with no email",
    severity: "warning",
    autoFixable: false,
    sql: `
      SELECT athlete_uuid::text, name
      FROM analytics.d_athletes
      WHERE (email IS NULL OR email = '')
        AND created_at >= CURRENT_DATE - INTERVAL '180 days'
        AND (
          has_pitching_data OR has_hitting_data OR has_athletic_screen_data
          OR has_readiness_screen_data OR has_mobility_data OR has_pro_sup_data
          OR has_arm_action_data OR has_proteus_data
        )
      ORDER BY name
      LIMIT 50
    `,
  },
  {
    id: "missing_height_weight",
    label: "Athletes created in last 180 days missing height or weight",
    severity: "warning",
    autoFixable: true,
    fixEndpoint: "/api/dashboard/audit/fix-height-weight",
    sql: `
      SELECT athlete_uuid::text, name,
        height IS NULL AS missing_height,
        weight IS NULL AS missing_weight
      FROM analytics.d_athletes
      WHERE (height IS NULL OR weight IS NULL)
        AND created_at >= CURRENT_DATE - INTERVAL '180 days'
        AND (
          has_pitching_data OR has_hitting_data OR has_athletic_screen_data
          OR has_readiness_screen_data OR has_mobility_data OR has_pro_sup_data
        )
      ORDER BY name
      LIMIT 50
    `,
  },
  {
    id: "stale_octane_sync",
    label: "Athletes with email whose Octane sync is >30 days old",
    severity: "warning",
    autoFixable: false,
    sql: `
      SELECT athlete_uuid::text, name, email, app_db_uuid::text, app_db_synced_at
      FROM analytics.d_athletes
      WHERE email IS NOT NULL AND email != ''
        AND app_db_uuid IS NOT NULL
        AND app_db_synced_at < NOW() - INTERVAL '30 days'
      ORDER BY app_db_synced_at ASC
      LIMIT 50
    `,
  },

  // ── Tier 3: Info ────────────────────────────────────────────────────────
  {
    id: "orphaned_source_map",
    label: "Orphaned source_athlete_map rows (no matching athlete)",
    severity: "info",
    autoFixable: false,
    sql: `
      SELECT m.source_system, m.source_athlete_id, m.athlete_uuid::text
      FROM analytics.source_athlete_map m
      LEFT JOIN analytics.d_athletes a ON a.athlete_uuid = m.athlete_uuid
      WHERE a.athlete_uuid IS NULL
      LIMIT 50
    `,
  },
  {
    id: "readiness_stuck_insufficient",
    label: "Athletes with 3+ readiness sessions still showing INSUFFICIENT_HISTORY",
    severity: "info",
    autoFixable: false,
    sql: `
      SELECT
        a.athlete_uuid::text,
        a.name,
        COUNT(DISTINCT rs.session_date) AS readiness_sessions,
        latest.band,
        latest.session_date AS latest_score_date,
        latest.scoring_tier
      FROM analytics.d_athletes a
      JOIN public.f_readiness_screen rs ON rs.athlete_uuid = a.athlete_uuid
        AND rs.session_date >= CURRENT_DATE - INTERVAL '180 days'
      LEFT JOIN public.f_readiness_screen_score latest ON latest.athlete_uuid = a.athlete_uuid
        AND latest.session_date = (
          SELECT MAX(session_date)
          FROM public.f_readiness_screen_score
          WHERE athlete_uuid = a.athlete_uuid
        )
      GROUP BY a.athlete_uuid, a.name, latest.band, latest.session_date, latest.scoring_tier
      HAVING COUNT(DISTINCT rs.session_date) >= 3
        AND (latest.band = 'INSUFFICIENT_HISTORY' OR latest.band IS NULL)
      ORDER BY readiness_sessions DESC
      LIMIT 50
    `,
  },
  {
    id: "duplicate_names",
    label: "Duplicate normalized_names (UNIQUE constraint violation risk)",
    severity: "info",
    autoFixable: false,
    sql: `
      SELECT normalized_name, COUNT(*)::int AS count, array_agg(athlete_uuid::text)::text AS uuids
      FROM analytics.d_athletes
      GROUP BY normalized_name
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `,
  },

  // ── Tier 4: Data Validation (values present but corrupt) ─────────────────
  {
    id: "bad_email_format",
    label: "Athletes with email that has no '@' (corrupt/misformatted)",
    severity: "critical",
    autoFixable: false,
    sql: `
      SELECT athlete_uuid::text, name, email
      FROM analytics.d_athletes
      WHERE email IS NOT NULL AND email != ''
        AND email NOT LIKE '%@%'
      ORDER BY name
      LIMIT 50
    `,
  },
  {
    id: "invalid_height",
    label: "Athletes with height outside 40–90 inches",
    severity: "warning",
    autoFixable: false,
    sql: `
      SELECT athlete_uuid::text, name, height::text AS height_stored
      FROM analytics.d_athletes
      WHERE height IS NOT NULL
        AND (height < 40 OR height > 90)
      ORDER BY height, name
      LIMIT 50
    `,
  },
  {
    id: "invalid_weight",
    label: "Athletes with weight outside 60–350 lbs",
    severity: "warning",
    autoFixable: false,
    sql: `
      SELECT athlete_uuid::text, name, weight::text AS weight_stored
      FROM analytics.d_athletes
      WHERE weight IS NOT NULL
        AND (weight < 60 OR weight > 350)
      ORDER BY weight, name
      LIMIT 50
    `,
  },
  {
    id: "invalid_dob",
    label: "Athletes with DOB that implies age <5 or >80, or is in the future",
    severity: "warning",
    autoFixable: false,
    sql: `
      SELECT athlete_uuid::text, name, date_of_birth::text,
        EXTRACT(YEAR FROM AGE(date_of_birth))::int AS age_years
      FROM analytics.d_athletes
      WHERE date_of_birth IS NOT NULL
        AND (
          date_of_birth > CURRENT_DATE
          OR EXTRACT(YEAR FROM AGE(date_of_birth)) < 5
          OR EXTRACT(YEAR FROM AGE(date_of_birth)) > 80
        )
      ORDER BY name
      LIMIT 50
    `,
  },
];

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET() {
  await requireAuth();

  const start = Date.now();

  const results = await Promise.allSettled(
    CHECKS.map(async (check) => {
      const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        check.sql
      );
      // Prisma returns BigInt for some aggregates — stringify them for JSON
      const safeRows = rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [
            k,
            typeof v === "bigint" ? Number(v) : v,
          ])
        )
      );
      return {
        id: check.id,
        label: check.label,
        severity: check.severity,
        count: safeRows.length,
        rows: safeRows,
        autoFixable: check.autoFixable,
        fixEndpoint: check.fixEndpoint,
      } satisfies AuditCheck;
    })
  );

  const checks: AuditCheck[] = results.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    console.error(`Audit check "${CHECKS[i].id}" failed:`, result.reason);
    return {
      id: CHECKS[i].id,
      label: CHECKS[i].label,
      severity: "info" as AuditSeverity,
      count: -1,
      rows: [{ error: String(result.reason) }],
      autoFixable: false,
    };
  });

  const summary = {
    critical: checks.filter((c) => c.severity === "critical" && c.count > 0).length,
    warning: checks.filter((c) => c.severity === "warning" && c.count > 0).length,
    info: checks.filter((c) => c.severity === "info" && c.count > 0).length,
  };

  const report: AuditReport = {
    runAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    checks,
    summary,
  };

  try {
    await prisma.auditLog.create({
      data: {
        duration_ms: report.durationMs,
        triggered_by: "manual",
        critical_count: summary.critical,
        warning_count: summary.warning,
        info_count: summary.info,
        report_json: report as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (logErr) {
    console.error("Failed to write audit log:", logErr);
  }

  return success(report);
}
