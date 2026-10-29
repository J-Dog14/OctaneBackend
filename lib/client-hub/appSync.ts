/**
 * Client Hub sync: 8ctane app snapshot → coach.hub_* tables.
 *
 *   1. Every app user with a program becomes (or stays) a hub client, linked to a
 *      warehouse athlete (lib/client-hub/matching.ts). Users never assessed in the lab
 *      get a new analytics.d_athletes row (source_system 'octane_app').
 *   2. Every app program becomes a period on that client (app dates refreshed; coach
 *      overrides untouched). Programs gone from the app are flagged, not deleted.
 *   3. Status: active while a period is current, else expired. When a NEW program shows
 *      up for a client a coach had marked expired/paused, the override is cleared — the
 *      client is back.
 *   4. For active clients: last scheduled day, 7-day check-offs, last tick, and the
 *      plyos / lifts / delivery "updated" dates (forward only) from the training calendar.
 *
 * Nothing here writes to the 8ctane app. Safe to run repeatedly; concurrent runs skip.
 */

import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { CALENDAR_LOOKAHEAD_DAYS, CALENDAR_LOOKBACK_DAYS, SYNC_MAX_AGE_HOURS, UPDATE_FIELDS, UPDATE_KINDS } from './constants';
import { lastNewSessionDate, lastWeek, tally } from './checkoffs';
import { addDays, todayIso } from './dates';
import { decideLinks, type ExistingClient, type WarehouseAthlete } from './matching';
import { guard } from './repository';
import { loadAppUsers, loadCalendars, snapshotTime } from './snapshot';
import type { AppUser, HubClient } from './types';

export interface SyncResult {
  skipped?: 'running' | 'fresh';
  clients: number;
  newClients: number;
  athletesCreated: number;
  athletesLinked: number;
  needLinkReview: number;
  newPeriods: number;
  reactivated: number;
  statusChanges: number;
  calendarClients: number;
  calendarAvailable: boolean;
  ms: number;
  /** Names behind athletesCreated / needLinkReview (first 200), for checking a dry run. */
  preview: { create: string[]; review: string[] };
  dryRun?: boolean;
}

class DryRunRollback extends Error {
  constructor(public result: SyncResult) {
    super('dry run');
  }
}

const LOCK_KEY = 74_211_903; // pg_advisory lock id for the hub sync

/** Last time any client was synced (null = never). */
export async function lastSyncAt(): Promise<string | null> {
  const r = await guard(() => prisma.$queryRawUnsafe<Array<{ t: string | null }>>(`SELECT max(synced_at)::text AS t FROM coach.hub_clients`));
  return r[0]?.t ?? null;
}

/** Never synced, synced more than 6 h ago, or the app snapshot was refreshed since the last hub sync. */
export async function isStale(now = new Date()): Promise<boolean> {
  const [t, snap] = await Promise.all([lastSyncAt(), snapshotTime()]);
  if (!t) return true;
  if (snap && Date.parse(snap) > Date.parse(t)) return true;
  return now.getTime() - Date.parse(t) > SYNC_MAX_AGE_HOURS * 3_600_000;
}

/** `dryRun`: do everything inside the transaction, report, then roll back (nothing is written). */
export async function syncHub(opts: { force?: boolean; dryRun?: boolean; now?: Date } = {}): Promise<SyncResult> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const today = todayIso(now);
  const empty: SyncResult = {
    clients: 0, newClients: 0, athletesCreated: 0, athletesLinked: 0, needLinkReview: 0, newPeriods: 0,
    reactivated: 0, statusChanges: 0, calendarClients: 0, calendarAvailable: true, ms: 0, preview: { create: [], review: [] },
  };
  if (!opts.force && !opts.dryRun && !(await isStale(now))) return { ...empty, skipped: 'fresh', ms: Date.now() - started };

  const users = await loadAppUsers();
  const [athletes, existing] = await Promise.all([
    prisma.$queryRawUnsafe<WarehouseAthlete[]>(
      `SELECT athlete_uuid AS "athleteUuid", name, normalized_name AS "normalizedName", lower(btrim(email)) AS email, app_db_uuid AS "appDbUuid"
       FROM analytics.d_athletes`,
    ),
    guard(() =>
      prisma.$queryRawUnsafe<ExistingClient[]>(
        `SELECT id::text AS id, app_user_id AS "appUserId", athlete_uuid AS "athleteUuid", link_method AS "linkMethod" FROM coach.hub_clients`,
      ),
    ),
  ]);
  const decisions = decideLinks(users, athletes, existing);
  const preview = {
    create: users.filter((u) => decisions.get(u.id)?.kind === 'create').map((u) => u.name).slice(0, 200),
    review: users.filter((u) => decisions.get(u.id)?.kind === 'review').map((u) => u.name).slice(0, 200),
  };

  let result: SyncResult;
  try {
    result = await prisma.$transaction(
    async (tx) => {
      const lock = await tx.$queryRawUnsafe<Array<{ ok: boolean }>>(`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS ok`);
      if (!lock[0]?.ok) return { ...empty, skipped: 'running' as const };
      const r = { ...empty };

      // 1a. New warehouse athletes for clients never seen in the lab.
      const toCreate: Array<{ uuid: string; user: AppUser; normalizedName: string }> = [];
      for (const u of users) {
        const dcs = decisions.get(u.id);
        if (dcs?.kind === 'create') toCreate.push({ uuid: randomUUID(), user: u, normalizedName: dcs.normalizedName });
      }
      const created = new Map<string, string>(); // app user id → athlete uuid
      if (toCreate.length) {
        const rows = await tx.$queryRawUnsafe<Array<{ athlete_uuid: string; source_athlete_id: string }>>(
          `INSERT INTO analytics.d_athletes (athlete_uuid, name, normalized_name, email, source_system, source_athlete_id, app_db_uuid, app_db_synced_at)
           SELECT x.uuid, x.name, x.normalized_name, x.email, 'octane_app', x.user_id, x.user_id, now()
           FROM jsonb_to_recordset($1::jsonb) AS x(uuid text, name text, normalized_name text, email text, user_id text)
           ON CONFLICT DO NOTHING
           RETURNING athlete_uuid, source_athlete_id`,
          JSON.stringify(toCreate.map((c) => ({ uuid: c.uuid, name: c.user.name, normalized_name: c.normalizedName, email: c.user.email, user_id: c.user.id }))),
        );
        for (const row of rows) created.set(row.source_athlete_id, row.athlete_uuid);
        r.athletesCreated = rows.length;
      }

      // 1b. Record the app account on athletes matched by email / name.
      const setAppIds = users.flatMap((u) => {
        const dcs = decisions.get(u.id);
        return dcs?.kind === 'link' && dcs.setAppDbUuid ? [{ athlete: dcs.athleteUuid, user: u.id }] : [];
      });
      if (setAppIds.length) {
        await tx.$executeRawUnsafe(
          `UPDATE analytics.d_athletes a SET app_db_uuid = x.user_id, app_db_synced_at = now()
           FROM jsonb_to_recordset($1::jsonb) AS x(athlete text, user_id text)
           WHERE a.athlete_uuid = x.athlete AND a.app_db_uuid IS NULL`,
          JSON.stringify(setAppIds.map((s) => ({ athlete: s.athlete, user_id: s.user }))),
        );
      }

      // 1c. Clients.
      const clientRows = users.map((u) => {
        const dcs = decisions.get(u.id)!;
        let athlete: string | null = null;
        let method: string | null = null;
        let review = false;
        let candidates: unknown = null;
        if (dcs.kind === 'keep') athlete = dcs.athleteUuid;
        else if (dcs.kind === 'link') {
          athlete = dcs.athleteUuid;
          method = dcs.method;
          r.athletesLinked++;
        } else if (dcs.kind === 'create') {
          athlete = created.get(u.id) ?? null;
          method = athlete ? 'created' : null;
          review = !athlete;
        } else {
          review = true;
          candidates = dcs.candidates;
        }
        if (review) r.needLinkReview++;
        return { user_id: u.id, name: u.name, email: u.email, athlete, method, keep: dcs.kind === 'keep', review, candidates };
      });
      const upserted = await tx.$queryRawUnsafe<Array<{ id: string; app_user_id: string; inserted: boolean }>>(
        `INSERT INTO coach.hub_clients AS c (app_user_id, name, email, athlete_uuid, link_method, link_review, link_candidates, synced_at)
         SELECT x.user_id, x.name, x.email, x.athlete, x.method, x.review, x.candidates, NULL
         FROM jsonb_to_recordset($1::jsonb) AS x(user_id text, name text, email text, athlete text, method text, keep boolean, review boolean, candidates jsonb)
         ON CONFLICT (app_user_id) DO UPDATE SET
           name = EXCLUDED.name,
           email = COALESCE(EXCLUDED.email, c.email),
           athlete_uuid = CASE WHEN c.athlete_uuid IS NULL AND c.link_method IS DISTINCT FROM 'coach' THEN EXCLUDED.athlete_uuid ELSE c.athlete_uuid END,
           link_method = CASE WHEN c.athlete_uuid IS NULL AND c.link_method IS DISTINCT FROM 'coach' THEN EXCLUDED.link_method ELSE c.link_method END,
           link_review = CASE WHEN c.athlete_uuid IS NULL AND c.link_method IS DISTINCT FROM 'coach' THEN EXCLUDED.link_review ELSE false END,
           link_candidates = CASE WHEN c.athlete_uuid IS NULL AND c.link_method IS DISTINCT FROM 'coach' THEN EXCLUDED.link_candidates ELSE NULL END
         RETURNING c.id::text AS id, c.app_user_id, (xmax = 0) AS inserted`,
        JSON.stringify(clientRows),
      );
      r.clients = upserted.length;
      r.newClients = upserted.filter((u) => u.inserted).length;
      for (const u of upserted.filter((x) => x.inserted)) {
        await tx.$executeRawUnsafe(
          `INSERT INTO coach.hub_client_events (client_id, actor, actor_name, action, detail) VALUES ($1::uuid, 'sync', 'Sync', 'client.new', NULL)`,
          u.id,
        );
      }

      // 2. Periods.
      const programs = users.flatMap((u) =>
        u.programs.map((p) => ({
          id: p.id, user_id: u.id, name: p.name, type: p.type, coaches: p.coaches, start: p.start, end: p.end,
          archived: p.archived, first_day: p.firstDay, last_day: p.lastDay,
        })),
      );
      const periods = await tx.$queryRawUnsafe<Array<{ id: number; client_id: string; name: string | null; inserted: boolean }>>(
        `INSERT INTO coach.hub_client_programs AS p (client_id, source, app_program_id, name, program_type, coach_names,
                                                     app_start, app_end, app_archived, app_first_day, app_last_day, removed_in_app)
         SELECT c.id, 'app', x.id, x.name, x.type, COALESCE(x.coaches, '{}'), x.start, x."end", x.archived, x.first_day, x.last_day, false
         FROM jsonb_to_recordset($1::jsonb) AS x(id int, user_id text, name text, type text, coaches text[], start date, "end" date,
                                                  archived boolean, first_day date, last_day date)
         JOIN coach.hub_clients c ON c.app_user_id = x.user_id
         ON CONFLICT (app_program_id) DO UPDATE SET
           client_id = EXCLUDED.client_id, name = EXCLUDED.name, program_type = EXCLUDED.program_type, coach_names = EXCLUDED.coach_names,
           app_start = EXCLUDED.app_start, app_end = EXCLUDED.app_end, app_archived = EXCLUDED.app_archived,
           app_first_day = EXCLUDED.app_first_day, app_last_day = EXCLUDED.app_last_day, removed_in_app = false,
           updated_at = CASE WHEN (p.name, p.program_type, p.app_start, p.app_end, p.app_archived, p.removed_in_app)
                                  IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.program_type, EXCLUDED.app_start, EXCLUDED.app_end, EXCLUDED.app_archived, false)
                             THEN now() ELSE p.updated_at END
         RETURNING p.id::int AS id, p.client_id::text AS client_id, p.name, (xmax = 0) AS inserted`,
        JSON.stringify(programs),
      );
      const newPeriods = periods.filter((p) => p.inserted);
      r.newPeriods = newPeriods.length;
      await tx.$executeRawUnsafe(
        `UPDATE coach.hub_client_programs SET removed_in_app = true, updated_at = now()
         WHERE source = 'app' AND NOT removed_in_app AND NOT (app_program_id = ANY($1::int[]))`,
        programs.map((p) => p.id),
      );

      // 3. A new program brings a client back: clear an expired / paused override, then recompute status.
      const brandNew = new Set(upserted.filter((u) => u.inserted).map((u) => u.id));
      const comeback = [...new Set(newPeriods.map((p) => p.client_id))].filter((id) => !brandNew.has(id));
      if (comeback.length) {
        const cleared = await tx.$queryRawUnsafe<Array<{ id: string; was: string }>>(
          `UPDATE coach.hub_clients c SET status_override = NULL, status_changed_at = now()
           FROM (SELECT id, status_override AS was FROM coach.hub_clients WHERE id = ANY($1::uuid[]) AND status_override IN ('expired', 'paused')) o
           WHERE c.id = o.id RETURNING c.id::text AS id, o.was`,
          comeback,
        );
        r.reactivated = cleared.length;
        for (const p of newPeriods.filter((x) => !brandNew.has(x.client_id))) {
          const was = cleared.find((c) => c.id === p.client_id)?.was;
          await tx.$executeRawUnsafe(
            `INSERT INTO coach.hub_client_events (client_id, actor, actor_name, action, detail) VALUES ($1::uuid, 'sync', 'Sync', 'period.new', $2::jsonb)`,
            p.client_id,
            JSON.stringify({ periodId: p.id, program: p.name, ...(was ? { clearedOverride: was } : {}) }),
          );
        }
      }
      const changed = await tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT coach.hub_refresh_status(NULL) AS n`);
      r.statusChanges = Number(changed[0]?.n ?? 0);
      r.preview = preview;
      if (opts.dryRun) throw new DryRunRollback(r);
      return r;
    },
    { timeout: 120_000, maxWait: 15_000 },
    );
  } catch (err) {
    if (err instanceof DryRunRollback) return { ...err.result, dryRun: true, ms: Date.now() - started };
    throw err;
  }
  if (result.skipped) return { ...result, ms: Date.now() - started };

  // 4. Training calendar for active clients (outside the transaction: read-heavy, per-client updates).
  const cal = await syncCalendars(today, now);
  return { ...result, calendarClients: cal.clients, calendarAvailable: cal.available, ms: Date.now() - started };
}

/** Check-offs, last tick, last scheduled day and "updated" dates for active clients. */
export async function syncCalendars(today: string, now: Date, onlyClientId?: string): Promise<{ clients: number; available: boolean }> {
  const clients = await guard(() =>
    prisma.$queryRawUnsafe<Array<Pick<HubClient, 'id' | 'appUserId' | 'updPlyos' | 'updLifts' | 'updDelivery' | 'lastTick'>>>(
      `SELECT id::text AS id, app_user_id AS "appUserId", upd_plyos::text AS "updPlyos", upd_lifts::text AS "updLifts",
              upd_delivery::text AS "updDelivery", last_tick::text AS "lastTick"
       FROM coach.hub_clients WHERE is_active AND app_user_id IS NOT NULL ${onlyClientId ? 'AND id = $1::uuid' : ''}`,
      ...(onlyClientId ? [onlyClientId] : []),
    ),
  );
  if (!clients.length) return { clients: 0, available: true };
  const calendars = await loadCalendars(clients.map((c) => c.appUserId!), addDays(today, -CALENDAR_LOOKBACK_DAYS), addDays(today, CALENDAR_LOOKAHEAD_DAYS));

  const rows = clients.map((c) => {
    const days = calendars?.get(c.appUserId!) ?? [];
    const week = tally(lastWeek(days, today));
    const upto = tally(days.filter((d) => d.date <= today));
    const upd: Record<string, string | null> = {};
    for (const f of UPDATE_FIELDS) {
      const changed = lastNewSessionDate(days, UPDATE_KINDS[f], today);
      upd[f] = changed && (!c[f] || changed > c[f]!) ? changed : null; // forward only
    }
    return {
      id: c.id,
      week_done: calendars ? week.done : null,
      week_trackable: calendars ? week.trackable : null,
      last_tick: upto.lastTick,
      upd_plyos: upd.updPlyos,
      upd_lifts: upd.updLifts,
      upd_delivery: upd.updDelivery,
    };
  });

  await prisma.$executeRawUnsafe(
    `UPDATE coach.hub_clients c SET
       week_done = x.week_done, week_trackable = x.week_trackable,
       last_tick = GREATEST(c.last_tick, x.last_tick),
       upd_plyos = COALESCE(x.upd_plyos, c.upd_plyos),
       upd_plyos_source = CASE WHEN x.upd_plyos IS NOT NULL THEN 'app' ELSE c.upd_plyos_source END,
       upd_lifts = COALESCE(x.upd_lifts, c.upd_lifts),
       upd_lifts_source = CASE WHEN x.upd_lifts IS NOT NULL THEN 'app' ELSE c.upd_lifts_source END,
       upd_delivery = COALESCE(x.upd_delivery, c.upd_delivery),
       upd_delivery_source = CASE WHEN x.upd_delivery IS NOT NULL THEN 'app' ELSE c.upd_delivery_source END,
       last_scheduled = (SELECT max(p.app_last_day) FROM coach.hub_client_programs p
                         WHERE p.client_id = c.id AND coach.hub_period_is_current(p, coach.hub_today())),
       synced_at = $2::timestamptz
     FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, week_done int, week_trackable int, last_tick date,
                                              upd_plyos date, upd_lifts date, upd_delivery date)
     WHERE c.id = x.id`,
    JSON.stringify(rows),
    now.toISOString(),
  );
  // Expired / paused clients still get a sync stamp so the list knows the data is current.
  if (!onlyClientId) {
    await prisma.$executeRawUnsafe(`UPDATE coach.hub_clients SET synced_at = $1::timestamptz WHERE NOT is_active`, now.toISOString());
  }
  return { clients: clients.length, available: calendars !== null };
}
