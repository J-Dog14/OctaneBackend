/**
 * Distinct session dates per tracking domain for one athlete (newest first).
 * Shared by /api/dashboard/athlete-tracking/sessions and the coach suite.
 */

import { prisma } from "@/lib/db/prisma";
import type { DomainId } from "@/lib/athlete-tracking/types";

export type DomainSessionDates = { domainId: DomainId; dates: string[] };

const DOMAINS: DomainId[] = ["pitching", "hitting", "mobility", "athleticScreen", "armAction", "proteus"];

/** Only domains with at least one session are returned. */
export async function getTrackingSessionDates(athleteUuid: string): Promise<DomainSessionDates[]> {
  // Prisma 6 findMany({ distinct }) deduplicates in memory. Kinematics tables
  // contain a row per frame/metric: let PostgreSQL return only distinct dates.
  // UNION also combines trial and legacy pitching dates without duplicates.
  const rows = await prisma.$queryRaw<Array<{ domain_id: DomainId; date: string }>>`
    SELECT 'pitching' AS domain_id, session_date::text AS date
      FROM public.f_pitching_trials WHERE athlete_uuid = ${athleteUuid}
    UNION
    SELECT 'pitching', session_date::text
      FROM public.f_kinematics_pitching WHERE athlete_uuid = ${athleteUuid}
    UNION
    SELECT 'hitting', session_date::text
      FROM public.f_kinematics_hitting WHERE athlete_uuid = ${athleteUuid}
    UNION
    SELECT 'mobility', session_date::text
      FROM public.f_mobility WHERE athlete_uuid = ${athleteUuid}
    UNION
    SELECT 'athleticScreen', session_date::text
      FROM public.v_athletic_screen_cmj WHERE athlete_uuid = ${athleteUuid}
    UNION
    SELECT 'athleticScreen', session_date::text
      FROM public.v_athletic_screen_dj WHERE athlete_uuid = ${athleteUuid}
    UNION
    SELECT 'athleticScreen', session_date::text
      FROM public.v_athletic_screen_ppu WHERE athlete_uuid = ${athleteUuid}
    UNION
    SELECT 'athleticScreen', session_date::text
      FROM public.v_athletic_screen_slv WHERE athlete_uuid = ${athleteUuid}
    UNION
    SELECT 'armAction', session_date::text
      FROM public.f_arm_action WHERE athlete_uuid = ${athleteUuid}
    UNION
    SELECT 'proteus', session_date::text
      FROM public.f_proteus WHERE athlete_uuid = ${athleteUuid}
    ORDER BY date DESC
  `;
  return DOMAINS.map((domainId) => ({
    domainId,
    dates: rows.filter((r) => r.domain_id === domainId).map((r) => r.date),
  })).filter((d) => d.dates.length > 0);
}
