/**
 * SQL for the hub tables (coach.hub_*, see uais/sql/create_coach_client_hub.sql).
 * Raw SQL like the rest of the coach suite: the coach schema isn't in Prisma.
 */

import { prisma } from '@/lib/db/prisma';
import type { Actor, AssessmentCheck, HubClient, HubEvent, HubNote, HubPeriod } from './types';

export class HubNotInstalledError extends Error {
  constructor() {
    super('The Client Hub tables are missing. Run uais/sql/create_coach_client_hub.sql against the warehouse.');
    this.name = 'HubNotInstalledError';
  }
}

export class HubNotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'HubNotFoundError';
  }
}

export class HubConflictError extends Error {}

/** Missing coach.hub_* relation → HubNotInstalledError; anything else rethrown. */
export async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const msg = String(err);
    // 3F000 = schema "coach" missing; 42P01 = table/view missing; 42883 = function missing.
    if (msg.includes('3F000') || ((msg.includes('hub_') || msg.includes('coach')) && (msg.includes('does not exist') || msg.includes('42P01') || msg.includes('42883')))) {
      throw new HubNotInstalledError();
    }
    throw err;
  }
}

const d = (col: string, as: string) => `${col}::text AS "${as}"`;

export const CLIENT_COLUMNS = `
  c.id::text AS id, c.athlete_uuid AS "athleteUuid", c.app_user_id AS "appUserId", c.name, c.email,
  c.link_method AS "linkMethod", c.link_review AS "linkReview", c.link_candidates AS "linkCandidates",
  c.auto_status AS "autoStatus", c.status_override AS "statusOverride", c.status, c.is_active AS "isActive",
  c.status_changed_at::text AS "statusChangedAt",
  c.phase, c.schedule_note AS "scheduleNote", c.coach_name AS "coachName",
  c.owner_clerk_user_id AS "ownerClerkUserId", c.owner_name AS "ownerName",
  c.throws, c.position, c.team, c.contract_duration AS "contractDuration",
  ${d('c.contract_start', 'contractStart')}, ${d('c.contract_end', 'contractEnd')}, c.contract_status AS "contractStatus",
  c.onb_assessment AS "onbAssessment", c.onb_3d AS "onb3d", c.onb_review AS "onbReview",
  ${d('c.last_contacted', 'lastContacted')}, ${d('c.next_assessment_due', 'nextAssessmentDue')}, c.needs_review AS "needsReview",
  ${d('c.upd_plyos', 'updPlyos')}, c.upd_plyos_source AS "updPlyosSource",
  ${d('c.upd_lifts', 'updLifts')}, c.upd_lifts_source AS "updLiftsSource",
  ${d('c.upd_delivery', 'updDelivery')}, c.upd_delivery_source AS "updDeliverySource",
  c.week_done AS "weekDone", c.week_trackable AS "weekTrackable", ${d('c.last_tick', 'lastTick')}, ${d('c.last_scheduled', 'lastScheduled')},
  c.synced_at::text AS "syncedAt", c.created_at::text AS "createdAt", c.updated_at::text AS "updatedAt", c.updated_by AS "updatedBy",
  c.period_id::int AS "periodId", c.program_name AS "programName", c.program_type AS "programType",
  COALESCE(c.program_coaches, '{}') AS "programCoaches",
  ${d('c.period_start', 'periodStart')}, ${d('c.period_end', 'periodEnd')}, c.period_span_days AS "periodSpanDays",
  c.period_days_left AS "periodDaysLeft", COALESCE(c.period_count, 0) AS "periodCount", ${d('c.client_since', 'clientSince')}`;

export async function listClients(): Promise<HubClient[]> {
  return guard(() => prisma.$queryRawUnsafe<HubClient[]>(`SELECT ${CLIENT_COLUMNS} FROM coach.v_hub_clients c ORDER BY c.name`));
}

export async function getClient(id: string): Promise<HubClient> {
  const rows = await guard(() => prisma.$queryRawUnsafe<HubClient[]>(`SELECT ${CLIENT_COLUMNS} FROM coach.v_hub_clients c WHERE c.id = $1::uuid`, id));
  if (!rows[0]) throw new HubNotFoundError('Client');
  return rows[0];
}

export async function clientForAthlete(athleteUuid: string): Promise<{ id: string; status: string; isActive: boolean } | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; status: string; isActive: boolean }>>(
      `SELECT id::text AS id, status, is_active AS "isActive" FROM coach.hub_clients WHERE athlete_uuid = $1`,
      athleteUuid,
    );
    return rows[0] ?? null;
  } catch (err) {
    if (String(err).includes('does not exist')) return null; // hub not installed yet
    throw err;
  }
}

const PERIOD_COLUMNS = `
  p.id::int AS id, p.client_id::text AS "clientId", p.source, p.app_program_id AS "appProgramId", p.name,
  p.program_type AS "programType", p.coach_names AS "coachNames",
  ${d('p.app_start', 'appStart')}, ${d('p.app_end', 'appEnd')}, p.app_archived AS "appArchived",
  ${d('p.app_first_day', 'appFirstDay')}, ${d('p.app_last_day', 'appLastDay')}, p.removed_in_app AS "removedInApp",
  ${d('p.start_override', 'startOverride')}, ${d('p.end_override', 'endOverride')},
  ${d('p.start_date', 'startDate')}, ${d('p.end_date', 'endDate')}, p.span_days AS "spanDays", p.note,
  coach.hub_period_is_current(p, coach.hub_today()) AS "isCurrent",
  p.updated_at::text AS "updatedAt", p.updated_by AS "updatedBy"`;

export async function listPeriods(clientId: string): Promise<HubPeriod[]> {
  return guard(() =>
    prisma.$queryRawUnsafe<HubPeriod[]>(
      `SELECT ${PERIOD_COLUMNS} FROM coach.hub_client_programs p WHERE p.client_id = $1::uuid
       ORDER BY p.start_date DESC NULLS LAST, p.id DESC`,
      clientId,
    ),
  );
}

export async function listChecks(clientIds: string[]): Promise<Map<string, AssessmentCheck[]>> {
  const out = new Map<string, AssessmentCheck[]>();
  if (!clientIds.length) return out;
  const rows = await guard(() =>
    prisma.$queryRawUnsafe<Array<AssessmentCheck & { clientId: string }>>(
      `SELECT id::int AS id, client_id::text AS "clientId", program_id::int AS "programId", kind, status,
              check_date::text AS "checkDate", note, created_by AS "createdBy", created_at::text AS "createdAt"
       FROM coach.hub_assessment_checks WHERE client_id = ANY($1::uuid[]) ORDER BY check_date DESC, id DESC`,
      clientIds,
    ),
  );
  for (const { clientId, ...r } of rows) out.set(clientId, [...(out.get(clientId) ?? []), r]);
  return out;
}

export async function listNotes(clientId: string): Promise<HubNote[]> {
  return guard(() =>
    prisma.$queryRawUnsafe<HubNote[]>(
      `SELECT id::int AS id, note_date::text AS date, body, goals, link, author_name AS "authorName", created_at::text AS "createdAt"
       FROM coach.hub_client_notes WHERE client_id = $1::uuid ORDER BY note_date DESC, id DESC`,
      clientId,
    ),
  );
}

export async function listEvents(clientId: string, limit = 40): Promise<HubEvent[]> {
  return guard(() =>
    prisma.$queryRawUnsafe<HubEvent[]>(
      `SELECT id::int AS id, at::text AS at, actor_name AS "actorName", action, detail
       FROM coach.hub_client_events WHERE client_id = $1::uuid ORDER BY at DESC, id DESC LIMIT ${Math.max(1, Math.min(200, limit))}`,
      clientId,
    ),
  );
}

export async function logEvent(clientId: string, actor: Actor | 'sync', action: string, detail: Record<string, unknown> | null) {
  const who = actor === 'sync' ? { id: 'sync', name: 'Sync' } : { id: actor.clerkUserId, name: actor.name };
  await prisma.$executeRawUnsafe(
    `INSERT INTO coach.hub_client_events (client_id, actor, actor_name, action, detail) VALUES ($1::uuid, $2, $3, $4, $5::jsonb)`,
    clientId,
    who.id,
    who.name,
    action,
    detail == null ? null : JSON.stringify(detail),
  );
}

// ---------------------------------------------------------------------------
// Client edits. Whitelist: API field → column and SQL type.
// ---------------------------------------------------------------------------

export const EDITABLE: Record<string, { col: string; type: 'text' | 'date' | 'bool' }> = {
  name: { col: 'name', type: 'text' },
  statusOverride: { col: 'status_override', type: 'text' },
  phase: { col: 'phase', type: 'text' },
  scheduleNote: { col: 'schedule_note', type: 'text' },
  coachName: { col: 'coach_name', type: 'text' },
  throws: { col: 'throws', type: 'text' },
  position: { col: 'position', type: 'text' },
  team: { col: 'team', type: 'text' },
  contractDuration: { col: 'contract_duration', type: 'text' },
  contractStart: { col: 'contract_start', type: 'date' },
  contractEnd: { col: 'contract_end', type: 'date' },
  contractStatus: { col: 'contract_status', type: 'text' },
  onbAssessment: { col: 'onb_assessment', type: 'bool' },
  onb3d: { col: 'onb_3d', type: 'bool' },
  onbReview: { col: 'onb_review', type: 'bool' },
  lastContacted: { col: 'last_contacted', type: 'date' },
  nextAssessmentDue: { col: 'next_assessment_due', type: 'date' },
  needsReview: { col: 'needs_review', type: 'bool' },
  updPlyos: { col: 'upd_plyos', type: 'date' },
  updLifts: { col: 'upd_lifts', type: 'date' },
  updDelivery: { col: 'upd_delivery', type: 'date' },
  ownerClerkUserId: { col: 'owner_clerk_user_id', type: 'text' },
  ownerName: { col: 'owner_name', type: 'text' },
};

const SOURCE_COL: Record<string, string> = { updPlyos: 'upd_plyos_source', updLifts: 'upd_lifts_source', updDelivery: 'upd_delivery_source' };

/** Applies `patch` (only whitelisted keys), logs old → new, returns the changed fields. */
export async function updateClientFields(id: string, patch: Record<string, unknown>, actor: Actor): Promise<string[]> {
  const keys = Object.keys(patch).filter((k) => k in EDITABLE);
  if (!keys.length) return [];
  const before = await getClient(id);
  const sets: string[] = [];
  const params: unknown[] = [id];
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) {
    const { col, type } = EDITABLE[k];
    const value = patch[k] ?? null;
    const old = (before as unknown as Record<string, unknown>)[k] ?? null;
    if (old === value) continue;
    params.push(value);
    sets.push(`${col} = $${params.length}${type === 'date' ? '::date' : type === 'bool' ? '::boolean' : ''}`);
    if (SOURCE_COL[k]) sets.push(`${SOURCE_COL[k]} = ${value == null ? 'NULL' : `'coach'`}`);
    if (k === 'statusOverride') sets.push('status_changed_at = now()');
    changes[k] = { from: old, to: value };
  }
  if (!sets.length) return [];
  params.push(actor.name);
  await prisma.$executeRawUnsafe(
    `UPDATE coach.hub_clients SET ${sets.join(', ')}, updated_at = now(), updated_by = $${params.length} WHERE id = $1::uuid`,
    ...params,
  );
  const fields = Object.keys(changes);
  await logEvent(id, actor, fields.includes('statusOverride') ? 'status' : 'update', changes);
  return fields;
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

async function getPeriod(clientId: string, periodId: number): Promise<HubPeriod> {
  const rows = await prisma.$queryRawUnsafe<HubPeriod[]>(
    `SELECT ${PERIOD_COLUMNS} FROM coach.hub_client_programs p WHERE p.id = $1 AND p.client_id = $2::uuid`,
    periodId,
    clientId,
  );
  if (!rows[0]) throw new HubNotFoundError('Program period');
  return rows[0];
}

export async function refreshStatus(clientId: string | null = null) {
  await prisma.$queryRawUnsafe(`SELECT coach.hub_refresh_status($1::uuid)`, clientId);
}

export interface PeriodPatch {
  startOverride?: string | null;
  endOverride?: string | null;
  name?: string | null;
  programType?: string | null;
  note?: string | null;
}

/**
 * App periods: only the overrides and the note change (the app's own dates stay as the app has them).
 * Coach-added periods: everything.
 */
export async function updatePeriod(clientId: string, periodId: number, patch: PeriodPatch, actor: Actor) {
  return guard(async () => {
    const p = await getPeriod(clientId, periodId);
    const allowed: Array<keyof PeriodPatch> = p.source === 'coach' ? ['startOverride', 'endOverride', 'name', 'programType', 'note'] : ['startOverride', 'endOverride', 'note'];
    const cols: Record<keyof PeriodPatch, string> = { startOverride: 'start_override', endOverride: 'end_override', name: 'name', programType: 'program_type', note: 'note' };
    const sets: string[] = [];
    const params: unknown[] = [periodId];
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of allowed) {
      if (!(k in patch)) continue;
      const value = patch[k] ?? null;
      if ((p[k as keyof HubPeriod] ?? null) === value) continue;
      params.push(value);
      sets.push(`${cols[k]} = $${params.length}${k.endsWith('Override') ? '::date' : ''}`);
      changes[k] = { from: p[k as keyof HubPeriod] ?? null, to: value };
    }
    if (!sets.length) return p;
    const start = 'startOverride' in changes ? (changes.startOverride.to as string | null) ?? p.appStart : p.startDate;
    const end = 'endOverride' in changes ? (changes.endOverride.to as string | null) ?? p.appEnd : p.endDate;
    if (start && end && end < start) throw new HubConflictError('End date is before the start date');
    params.push(actor.name);
    await prisma.$executeRawUnsafe(
      `UPDATE coach.hub_client_programs SET ${sets.join(', ')}, updated_at = now(), updated_by = $${params.length} WHERE id = $1`,
      ...params,
    );
    await logEvent(clientId, actor, 'period.update', { periodId, program: p.name, ...changes });
    await refreshStatus(clientId);
    return getPeriod(clientId, periodId);
  });
}

export async function addPeriod(
  clientId: string,
  input: { name: string; programType: string | null; start: string; end: string | null; note?: string | null },
  actor: Actor,
) {
  return guard(async () => {
    await getClient(clientId);
    if (input.end && input.end < input.start) throw new HubConflictError('End date is before the start date');
    const rows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `INSERT INTO coach.hub_client_programs (client_id, source, name, program_type, start_override, end_override, note, updated_by)
       VALUES ($1::uuid, 'coach', $2, $3, $4::date, $5::date, $6, $7) RETURNING id::int AS id`,
      clientId, input.name, input.programType, input.start, input.end, input.note ?? null, actor.name,
    );
    await logEvent(clientId, actor, 'period.add', { periodId: rows[0].id, ...input });
    await refreshStatus(clientId);
    return getPeriod(clientId, rows[0].id);
  });
}

/** Only coach-added periods can be deleted; app periods follow the app. */
export async function deletePeriod(clientId: string, periodId: number, actor: Actor) {
  return guard(async () => {
    const p = await getPeriod(clientId, periodId);
    if (p.source !== 'coach') throw new HubConflictError('Programs from the 8ctane app can’t be deleted here. Change their dates instead.');
    await prisma.$executeRawUnsafe(`DELETE FROM coach.hub_client_programs WHERE id = $1`, periodId);
    await logEvent(clientId, actor, 'period.delete', { periodId, name: p.name, start: p.startDate, end: p.endDate });
    await refreshStatus(clientId);
  });
}

// ---------------------------------------------------------------------------
// Notes and assessment checks
// ---------------------------------------------------------------------------

export async function addNote(clientId: string, input: { date: string; body: string; goals?: string; link?: string }, actor: Actor, today: string) {
  return guard(async () => {
    await getClient(clientId);
    const rows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `INSERT INTO coach.hub_client_notes (client_id, note_date, body, goals, link, author_clerk_user_id, author_name)
       VALUES ($1::uuid, $2::date, $3, $4, $5, $6, $7) RETURNING id::int AS id`,
      clientId, input.date, input.body, input.goals || null, input.link || null, actor.clerkUserId, actor.name,
    );
    // A note dated today counts as contact.
    if (input.date === today) {
      await prisma.$executeRawUnsafe(
        `UPDATE coach.hub_clients SET last_contacted = GREATEST(COALESCE(last_contacted, $2::date), $2::date) WHERE id = $1::uuid`,
        clientId, today,
      );
    }
    return rows[0].id;
  });
}

export async function deleteNote(clientId: string, noteId: number) {
  const n = await guard(() => prisma.$executeRawUnsafe(`DELETE FROM coach.hub_client_notes WHERE id = $1 AND client_id = $2::uuid`, noteId, clientId));
  if (!n) throw new HubNotFoundError('Note');
}

export async function addCheck(
  clientId: string,
  input: { kind: string; status: string; date: string; programId?: number | null; note?: string | null },
  actor: Actor,
) {
  return guard(async () => {
    await getClient(clientId);
    const rows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `INSERT INTO coach.hub_assessment_checks (client_id, program_id, kind, status, check_date, note, created_by)
       VALUES ($1::uuid, $2, $3, $4, $5::date, $6, $7) RETURNING id::int AS id`,
      clientId, input.programId ?? null, input.kind, input.status, input.date, input.note ?? null, actor.name,
    );
    await logEvent(clientId, actor, 'assessment.add', { ...input });
    return rows[0].id;
  });
}

export async function deleteCheck(clientId: string, checkId: number, actor: Actor) {
  const n = await guard(() => prisma.$executeRawUnsafe(`DELETE FROM coach.hub_assessment_checks WHERE id = $1 AND client_id = $2::uuid`, checkId, clientId));
  if (!n) throw new HubNotFoundError('Assessment entry');
  await logEvent(clientId, actor, 'assessment.delete', { checkId });
}

/**
 * A coach checks / unchecks an assessment for the current program. Checking adds a 'done'
 * entry tied to the program period; unchecking removes the coach's entries for that program.
 * Sessions in the warehouse still count either way (they can't be unchecked from here).
 */
export async function setChecklist(clientId: string, kind: string, done: boolean, actor: Actor, today: string) {
  return guard(async () => {
    const client = await getClient(clientId);
    const periodId = client.periodId;
    if (done) {
      const existing = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
        `SELECT id::int AS id FROM coach.hub_assessment_checks
         WHERE client_id = $1::uuid AND kind = $2 AND status = 'done' AND program_id IS NOT DISTINCT FROM $3`,
        clientId, kind, periodId,
      );
      if (!existing.length) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO coach.hub_assessment_checks (client_id, program_id, kind, status, check_date, created_by)
           VALUES ($1::uuid, $2, $3, 'done', $4::date, $5)`,
          clientId, periodId, kind, today, actor.name,
        );
      }
    } else {
      await prisma.$executeRawUnsafe(
        `DELETE FROM coach.hub_assessment_checks
         WHERE client_id = $1::uuid AND kind = $2 AND status = 'done'
           AND (program_id IS NOT DISTINCT FROM $3 OR program_id IS NULL)`,
        clientId, kind, periodId,
      );
    }
    await logEvent(clientId, actor, done ? 'assessment.check' : 'assessment.uncheck', { kind, program: client.programName });
  });
}
