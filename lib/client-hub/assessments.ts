/**
 * Assessment sessions in the warehouse, per athlete and kind. Read live (never copied into
 * the hub tables), so a screen ingested this morning shows up as "done" straight away.
 * Coach entries (scheduled / done elsewhere / waived) live in coach.hub_assessment_checks.
 */

import { prisma } from '@/lib/db/prisma';
import { isMissingRelation } from '@/lib/coach/program';
import type { AssessmentKind } from './constants';
import type { IsoDay } from './dates';

const SOURCES: Array<{ kind: AssessmentKind; sql: string }> = [
  { kind: 'athletic_screen', sql: `SELECT athlete_uuid, session_date FROM public.v_athletic_screen_sessions` },
  { kind: 'mobility', sql: `SELECT athlete_uuid, session_date FROM public.f_mobility` },
  { kind: 'pitching_3d', sql: `SELECT athlete_uuid, session_date FROM public.f_pitching_trials UNION SELECT athlete_uuid, session_date FROM public.f_kinematics_pitching` },
  { kind: 'hitting_3d', sql: `SELECT athlete_uuid, session_date FROM public.f_hitting_trials UNION SELECT athlete_uuid, session_date FROM public.f_kinematics_hitting` },
  { kind: 'arm_action', sql: `SELECT athlete_uuid, session_date FROM public.f_arm_action` },
  { kind: 'pro_sup', sql: `SELECT athlete_uuid, session_date FROM public.f_pro_sup` },
  { kind: 'proteus', sql: `SELECT athlete_uuid, session_date FROM public.f_proteus` },
  { kind: 'readiness', sql: `SELECT athlete_uuid, session_date FROM public.v_readiness_screen_sessions` },
  { kind: 'curveball', sql: `SELECT athlete_uuid, session_date FROM public.f_curveball_test` },
];

/** athlete_uuid → kind → session dates, newest first. */
export type AssessmentDates = Map<string, Map<AssessmentKind, IsoDay[]>>;

export async function loadAssessmentDates(athleteUuids: string[]): Promise<AssessmentDates> {
  const out: AssessmentDates = new Map();
  if (!athleteUuids.length) return out;
  await Promise.all(
    SOURCES.map(async ({ kind, sql }) => {
      let rows: Array<{ athlete_uuid: string; d: string }>;
      try {
        rows = await prisma.$queryRawUnsafe(
          `SELECT DISTINCT s.athlete_uuid, s.session_date::date::text AS d FROM (${sql}) s
           WHERE s.athlete_uuid = ANY($1::text[]) AND s.session_date IS NOT NULL`,
          athleteUuids,
        );
      } catch (err) {
        if (isMissingRelation(err)) return; // table not in this warehouse yet
        throw err;
      }
      for (const r of rows) {
        const kinds = out.get(r.athlete_uuid) ?? out.set(r.athlete_uuid, new Map()).get(r.athlete_uuid)!;
        kinds.set(kind, [...(kinds.get(kind) ?? []), r.d]);
      }
    }),
  );
  for (const kinds of out.values()) for (const [k, dates] of kinds) kinds.set(k, dates.sort().reverse());
  return out;
}

export { assessmentStatus, autoOnboarding, checklistFor, lastAssessment, type AssessmentStatus, type ChecklistItem } from './assessmentRules';
