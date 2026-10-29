// The profile's "In the app" card: program, days left, 14-day check-off strip, next 7 days.
import { ACTIVITY_LABELS, STRIP_DAYS, UPCOMING_DAYS } from './constants';
import { daysInRange, tally, type Tally } from './checkoffs';
import type { Coverage } from './coverage';
import { addDays, daysSince, type IsoDay } from './dates';
import type { CalendarDay, ClientFacts, HubProgram } from './types';

export interface StripDay {
  date: IsoDay;
  done: number;
  trackable: number;
  /** done / trackable, 0–1; null when nothing trackable was scheduled (draw hatched). */
  share: number | null;
  isToday: boolean;
}

export interface UpcomingDay {
  date: IsoDay;
  activities: { kind: string; label: string; name: string | null }[]; // empty = "Nothing scheduled"
}

export interface AppCard {
  program: { uuid: string; name: string; endDate: IsoDay | null; coaches: string[] } | null;
  coverage: Coverage;
  daysSinceContractStart: number | null;
  last14: Tally;
  strip: StripDay[];
  upcoming: UpcomingDay[];
}

function groupByDate(days: readonly CalendarDay[]): Map<IsoDay, CalendarDay[]> {
  const map = new Map<IsoDay, CalendarDay[]>();
  for (const d of days) map.set(d.date, [...(map.get(d.date) ?? []), d]);
  return map;
}

export function buildAppCard(
  c: ClientFacts,
  program: HubProgram | null,
  coverage: Coverage,
  days: readonly CalendarDay[],
  today: IsoDay,
): AppCard {
  const byDate = groupByDate(days);
  const stripDates = Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i - (STRIP_DAYS - 1)));
  const upcomingDates = Array.from({ length: UPCOMING_DAYS }, (_, i) => addDays(today, i + 1));
  const since = daysSince(c.contractStart, today);

  return {
    program: program
      ? { uuid: program.uuid, name: program.name, endDate: program.endDate, coaches: program.coaches.map((x) => x.name) }
      : null,
    coverage,
    daysSinceContractStart: since === null ? null : Math.max(0, since),
    last14: tally(daysInRange(days, stripDates[0], today)),
    strip: stripDates.map((date) => {
      const t = tally(byDate.get(date) ?? []);
      return { date, done: t.done, trackable: t.trackable, share: t.trackable ? t.done / t.trackable : null, isToday: date === today };
    }),
    upcoming: upcomingDates.map((date) => ({
      date,
      activities: (byDate.get(date) ?? [])
        .flatMap((d) => d.activities)
        .map((a) => ({ kind: a.kind, label: ACTIVITY_LABELS[a.kind] ?? a.kind, name: a.name })),
    })),
  };
}
