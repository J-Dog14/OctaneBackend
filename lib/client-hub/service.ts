// Client Hub use cases. Routes authenticate and validate, then call these.
import { prisma } from '@/lib/db/prisma';
import { normalizeName as looseName } from '@/lib/pitch-intel/match';
import { CALENDAR_LOOKAHEAD_DAYS, CALENDAR_LOOKBACK_DAYS, type ClientStatus, type ProgramType } from './constants';
import { assessmentStatus, autoOnboarding, checklistFor, lastAssessment, loadAssessmentDates } from './assessments';
import { lastSyncAt, syncCalendars } from './appSync';
import { addDays, todayIso } from './dates';
import { buildRow, filterAndSort, headlineStats, onboardingFor, type Focus } from './flags';
import { warehouseNormalizedName } from './matching';
import { buildAppCard } from './profile';
import {
  getClient, guard, HubConflictError, HubNotFoundError, listChecks, listClients as listClientRows, listEvents, listNotes, listPeriods, logEvent,
} from './repository';
import { loadCalendars, snapshotTime } from './snapshot';
import type { Actor } from './types';

export interface ListQuery {
  scope: 'mine' | 'all';
  status: ClientStatus | 'all';
  types: ProgramType[];
  focus: Focus | null;
  q: string;
}

export async function listHub(me: Actor, query: ListQuery, now = new Date()) {
  const today = todayIso(now);
  // Programs end overnight: keep active / expired current without waiting for a sync.
  await guard(() => prisma.$queryRawUnsafe(`SELECT coach.hub_refresh_status(NULL)`));
  const clients = await listClientRows();
  const athleteIds = clients.map((c) => c.athleteUuid).filter((x): x is string => !!x);
  const [dates, checks, syncedAt, snapshotAt] = await Promise.all([
    loadAssessmentDates(athleteIds),
    listChecks(clients.map((c) => c.id)),
    lastSyncAt(),
    snapshotTime(),
  ]);

  const scoped = clients
    .filter((c) => query.scope === 'all' || c.ownerClerkUserId === me.clerkUserId)
    .map((c) => {
      const d = c.athleteUuid ? dates.get(c.athleteUuid) : undefined;
      const ch = checks.get(c.id) ?? [];
      const checklist = checklistFor(d, ch, c.periodStart, c.periodId);
      return buildRow(c, { onboarding: onboardingFor(c, autoOnboarding(checklist)), lastAssessment: lastAssessment(d, ch), checklist, isMine: c.ownerClerkUserId === me.clerkUserId }, today);
    });
  const typed = query.types.length ? scoped.filter((r) => r.programType && query.types.includes(r.programType)) : scoped;

  return {
    today,
    stats: headlineStats(typed),
    rows: filterAndSort(typed, { status: query.status, types: [], focus: query.focus, query: query.q }),
    totalClients: clients.length,
    syncedAt,
    snapshotAt,
  };
}

/** Everything the client page shows. Re-reads this client's calendar from the snapshot first. */
export async function getClientDetail(id: string, me: Actor, now = new Date()) {
  const today = todayIso(now);
  await guard(() => prisma.$queryRawUnsafe(`SELECT coach.hub_refresh_status($1::uuid)`, id));
  let client = await getClient(id);
  let calendarError: string | null = null;
  let calendar = null;
  const appUserId = client.appUserId;
  if (client.isActive && appUserId) {
    try {
      await syncCalendars(today, now, id);
      client = await getClient(id);
      const cals = await loadCalendars([appUserId], addDays(today, -CALENDAR_LOOKBACK_DAYS), addDays(today, CALENDAR_LOOKAHEAD_DAYS));
      calendar = cals ? buildAppCard(cals.get(appUserId) ?? [], today) : null;
      if (!cals) calendarError = 'The app snapshot has no workout tables yet. Run "Sync database".';
    } catch (err) {
      console.error(`[client-hub] calendar for ${id}:`, err);
      calendarError = 'Couldn’t read the app snapshot just now.';
    }
  }

  const [periods, notes, events, checksMap, dates, snapshotAt] = await Promise.all([
    listPeriods(id),
    listNotes(id),
    listEvents(id),
    listChecks([id]),
    client.athleteUuid ? loadAssessmentDates([client.athleteUuid]) : Promise.resolve(new Map()),
    snapshotTime(),
  ]);
  const checks = checksMap.get(id) ?? [];
  const d = client.athleteUuid ? dates.get(client.athleteUuid) : undefined;
  const checklist = checklistFor(d, checks, client.periodStart, client.periodId);
  const onboarding = onboardingFor(client, autoOnboarding(checklist));
  const row = buildRow(client, { onboarding, lastAssessment: lastAssessment(d, checks), checklist, isMine: client.ownerClerkUserId === me.clerkUserId }, today);

  return {
    today,
    client,
    row,
    periods,
    onboarding,
    checklist,
    assessments: assessmentStatus(d, checks, client.periodStart, today),
    checks,
    notes,
    events,
    calendar,
    calendarError,
    snapshotAt,
  };
}

/** For the athlete page's Program Management tab. */
export { clientForAthlete } from './repository';

// ---------------------------------------------------------------------------
// Linking a client to a warehouse athlete by hand (the "review" case)
// ---------------------------------------------------------------------------

export async function linkClientToAthlete(id: string, athleteUuid: string, actor: Actor) {
  return guard(async () => {
    const client = await getClient(id);
    const athlete = await prisma.$queryRawUnsafe<Array<{ athlete_uuid: string; name: string; app_db_uuid: string | null }>>(
      `SELECT athlete_uuid, name, app_db_uuid FROM analytics.d_athletes WHERE athlete_uuid = $1`,
      athleteUuid,
    );
    if (!athlete[0]) throw new HubNotFoundError('Athlete');
    if (athlete[0].app_db_uuid && client.appUserId && athlete[0].app_db_uuid !== client.appUserId) {
      throw new HubConflictError(`${athlete[0].name} is already linked to a different 8ctane app account.`);
    }
    const taken = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM coach.hub_clients WHERE athlete_uuid = $1 AND id <> $2::uuid`,
      athleteUuid,
      id,
    );
    if (taken[0]) throw new HubConflictError(`${athlete[0].name} is already linked to the hub client "${taken[0].name}".`);
    await prisma.$transaction([
      prisma.$executeRawUnsafe(
        `UPDATE coach.hub_clients SET athlete_uuid = $2, link_method = 'coach', link_review = false, link_candidates = NULL,
                updated_at = now(), updated_by = $3 WHERE id = $1::uuid`,
        id, athleteUuid, actor.name,
      ),
      ...(client.appUserId
        ? [prisma.$executeRawUnsafe(`UPDATE analytics.d_athletes SET app_db_uuid = $2, app_db_synced_at = now() WHERE athlete_uuid = $1 AND app_db_uuid IS NULL`, athleteUuid, client.appUserId)]
        : []),
    ]);
    await logEvent(id, actor, 'link', { athleteUuid, athlete: athlete[0].name, previous: client.athleteUuid });
  });
}

/** "None of these": create a new warehouse athlete for this client. */
export async function createAthleteForClient(id: string, actor: Actor) {
  return guard(async () => {
    const client = await getClient(id);
    if (client.athleteUuid) throw new HubConflictError('This client is already linked to an athlete.');
    const normalized = warehouseNormalizedName(client.name);
    const clash = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT name FROM analytics.d_athletes WHERE normalized_name = $1`, normalized);
    if (clash[0]) throw new HubConflictError(`An athlete named "${clash[0].name}" already exists. Link to them instead, or rename the client first.`);
    const uuid = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO analytics.d_athletes (athlete_uuid, name, normalized_name, email, source_system, source_athlete_id, app_db_uuid, app_db_synced_at)
       VALUES ($1, $2, $3, $4, 'octane_app', $5, $5, now())`,
      uuid, client.name, normalized, client.email, client.appUserId,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE coach.hub_clients SET athlete_uuid = $2, link_method = 'created', link_review = false, link_candidates = NULL,
              updated_at = now(), updated_by = $3 WHERE id = $1::uuid`,
      id, uuid, actor.name,
    );
    await logEvent(id, actor, 'link.create', { athleteUuid: uuid, name: client.name });
    return uuid;
  });
}

/** Athlete picker for the link dialog: best name matches first. */
export async function searchAthletes(q: string, limit = 12) {
  const term = looseName(q);
  if (!term) return [];
  return prisma.$queryRawUnsafe<Array<{ athleteUuid: string; name: string; email: string | null; linkedTo: string | null }>>(
    `SELECT a.athlete_uuid AS "athleteUuid", a.name, a.email, c.name AS "linkedTo"
     FROM analytics.d_athletes a LEFT JOIN coach.hub_clients c ON c.athlete_uuid = a.athlete_uuid
     WHERE upper(a.name) LIKE '%' || $1 || '%' OR a.normalized_name LIKE '%' || $1 || '%'
     ORDER BY (a.normalized_name = $1) DESC, a.name LIMIT ${Math.max(1, Math.min(50, limit))}`,
    term,
  );
}
