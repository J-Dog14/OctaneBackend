// What a sync with 8ctane changes on a client. Pure: the service layer reads and writes.
import { CALENDAR_LOOKAHEAD_DAYS, CALENDAR_LOOKBACK_DAYS, SYNC_MAX_AGE_HOURS, UPDATE_FIELDS, UPDATE_KINDS } from './constants';
import { lastNewSessionDate, lastWeek, tally } from './checkoffs';
import { addDays, type IsoDay } from './dates';
import type { CalendarDay, ClientFacts, DateSource, HubProgram, ProgramType } from './types';

export function calendarWindow(today: IsoDay): { startDate: IsoDay; endDate: IsoDay } {
  return { startDate: addDays(today, -CALENDAR_LOOKBACK_DAYS), endDate: addDays(today, CALENDAR_LOOKAHEAD_DAYS) };
}

export function needsSync(c: ClientFacts, now: Date): boolean {
  if (c.status !== 'ACTIVE' || !c.octaneAthleteUuid) return false;
  if (!c.syncedAt) return true;
  return now.getTime() - Date.parse(c.syncedAt) > SYNC_MAX_AGE_HOURS * 3_600_000;
}

function programTypeFromOctane(type: string | null): ProgramType | null {
  if (!type) return null;
  if (type === 'REMOTE') return 'REMOTE';
  if (type === 'HYBRID') return 'HYBRID';
  return 'IN_HOUSE';
}

export type SyncPatch = Partial<
  Pick<
    ClientFacts,
    | 'programType'
    | 'coachName'
    | 'updPlyos'
    | 'updPlyosSource'
    | 'updLifts'
    | 'updLiftsSource'
    | 'updDelivery'
    | 'updDeliverySource'
  >
> &
  Pick<ClientFacts, 'weekDone' | 'weekTrackable' | 'lastTick' | 'syncedAt'>;

/**
 * - Fills program type and coach only when the hub has none (never overwrites a coach's entry).
 * - Moves an "updated" date forward when 8ctane shows a newer new-session date; never backward.
 * - Refreshes the 7-day check-off cache.
 */
export function buildSyncPatch(c: ClientFacts, program: HubProgram | null, days: readonly CalendarDay[], today: IsoDay, now: Date): SyncPatch {
  const patch: Partial<SyncPatch> = {};

  if (program) {
    if (!c.programType) {
      const type = programTypeFromOctane(program.type);
      if (type) patch.programType = type;
    }
    if (!c.coachName && program.coaches.length) patch.coachName = program.coaches.map((x) => x.name).join(', ');
  }

  const octane: DateSource = 'OCTANE';
  for (const field of UPDATE_FIELDS) {
    const changed = lastNewSessionDate(days, UPDATE_KINDS[field], today);
    const current = c[field];
    if (changed && (!current || changed > current)) {
      patch[field] = changed;
      patch[`${field}Source`] = octane;
    }
  }

  const week = tally(lastWeek(days, today));
  const toDate = tally(days.filter((d) => d.date <= today));
  return {
    ...patch,
    weekDone: week.done,
    weekTrackable: week.trackable,
    lastTick: toDate.lastTick ?? c.lastTick,
    syncedAt: now.toISOString(),
  };
}

/** Run `task` over `items` with at most `limit` in flight. One failure doesn't stop the rest; failures are returned. */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<{ ok: number; failed: { item: T; error: unknown }[] }> {
  let next = 0;
  let ok = 0;
  const failed: { item: T; error: unknown }[] = [];
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await task(item);
        ok++;
      } catch (error) {
        failed.push({ item, error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return { ok, failed };
}
