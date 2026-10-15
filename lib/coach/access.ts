/**
 * Access checks for the coach suite (/coach, /api/coach/*).
 *
 * Today every coach (Clerk publicMetadata.role = "coach") and admin can see
 * every athlete. All coach routes go through these two functions, so adding
 * rosters later means changing canViewAthlete only (e.g. look up a
 * coach_rosters table by the Clerk user id).
 */

import { checkRoles, COACH_SUITE_ROLES } from "@/lib/auth/requireAuth";
import { notFound } from "@/lib/responses";
import { prisma } from "@/lib/db/prisma";

const UUID_RE = /^[A-Za-z0-9-]{1,64}$/;

/** 401/403 response when the caller can't use the coach suite, else null. */
export function requireCoach() {
  return checkRoles(COACH_SUITE_ROLES);
}

/** Roster hook. All athletes for now. */
async function canViewAthlete(athleteUuid: string): Promise<boolean> {
  const row = await prisma.d_athletes.findUnique({ where: { athlete_uuid: athleteUuid }, select: { athlete_uuid: true } });
  return row != null;
}

/**
 * Role check plus athlete check. Returns a response to send back (401/403/404)
 * or null when the caller may read this athlete. Unknown and not-allowed
 * athletes both answer 404 so the API doesn't reveal who exists.
 */
export async function requireCoachForAthlete(athleteUuid: string | null | undefined) {
  const denied = await requireCoach();
  if (denied) return denied;
  if (!athleteUuid || !UUID_RE.test(athleteUuid) || !(await canViewAthlete(athleteUuid))) {
    return notFound("Athlete not found");
  }
  return null;
}
