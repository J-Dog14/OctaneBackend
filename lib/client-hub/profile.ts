// The profile's "In the app" card: 14-day check-off strip and the next 7 days. Pure.
import { ACTIVITY_LABELS, STRIP_DAYS, UPCOMING_DAYS } from './constants';
import { daysInRange, tally, type Tally } from './checkoffs';
import { addDays, type IsoDay } from './dates';
import type { CalendarDay } from './types';

export interface StripDay {
  date: IsoDay;
  done: number;
  trackable: number;
  /** done / trackable, 0–1; null when nothing trackable was scheduled (drawn hatched). */
  share: number | null;
  scheduled: boolean;
  isToday: boolean;
}

export interface UpcomingDay {
  date: IsoDay;
  /** One entry per kind with the session names, e.g. Lift · "Back Squat, RDL …". Empty = nothing scheduled. */
  activities: { kind: string; label: string; names: string[] }[];
}

export interface AppCard {
  last14: Tally;
  strip: StripDay[];
  upcoming: UpcomingDay[];
}

export function buildAppCard(days: readonly CalendarDay[], today: IsoDay): AppCard {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const stripDates = Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i - (STRIP_DAYS - 1)));
  const upcomingDates = Array.from({ length: UPCOMING_DAYS }, (_, i) => addDays(today, i + 1));
  return {
    last14: tally(daysInRange(days, stripDates[0], today)),
    strip: stripDates.map((date) => {
      const day = byDate.get(date);
      const t = tally(day ? [day] : []);
      return { date, done: t.done, trackable: t.trackable, share: t.trackable ? t.done / t.trackable : null, scheduled: !!day?.activities.length, isToday: date === today };
    }),
    upcoming: upcomingDates.map((date) => {
      const kinds = new Map<string, Set<string>>();
      for (const a of byDate.get(date)?.activities ?? []) {
        const names = kinds.get(a.kind) ?? kinds.set(a.kind, new Set()).get(a.kind)!;
        if (a.name) names.add(a.name);
      }
      return {
        date,
        activities: [...kinds].map(([kind, names]) => ({ kind, label: ACTIVITY_LABELS[kind] ?? kind, names: [...names].slice(0, 6) })),
      };
    }),
  };
}
