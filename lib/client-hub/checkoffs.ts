// Set check-offs and "new session" detection from the 8ctane training calendar.
import { CHANGE_LOOKBACK_DAYS, CHANGE_WARMUP_DAYS } from './constants';
import { addDays, daysBetween, type IsoDay } from './dates';
import type { CalendarDay } from './types';

export interface Tally {
  /** Sets the athlete ticked. */
  done: number;
  /** Sets that *can* be ticked: planned minus those without per-set flags (most lifts). */
  trackable: number;
  /** Latest date with at least one ticked set. */
  lastTick: IsoDay | null;
}

/** Counts only what the athlete actually marked. Untracked activities (completion=null) are skipped entirely. */
export function tally(days: readonly CalendarDay[]): Tally {
  let done = 0;
  let trackable = 0;
  let lastTick: IsoDay | null = null;
  for (const day of days) {
    for (const activity of day.activities) {
      const c = activity.completion;
      if (!c) continue;
      done += c.completedSets;
      trackable += c.plannedSets - c.unknownSets;
      if (c.completedSets > 0 && (!lastTick || day.date > lastTick)) lastTick = day.date;
    }
  }
  return { done, trackable, lastTick };
}

/** Days from `from` through `to`, inclusive. */
export function daysInRange(days: readonly CalendarDay[], from: IsoDay, to: IsoDay): CalendarDay[] {
  return days.filter((d) => d.date >= from && d.date <= to);
}

/** The last 7 days including today. */
export function lastWeek(days: readonly CalendarDay[], today: IsoDay): CalendarDay[] {
  return daysInRange(days, addDays(today, -6), today);
}

/**
 * Latest day (up to today) that brought in a session of `kind` whose name wasn't scheduled in the
 * 21 days before it — i.e. when the coach last changed that part of the program.
 * The first week of data is skipped because there's no history to compare it against.
 */
export function lastNewSessionDate(days: readonly CalendarDay[], kind: string, today: IsoDay): IsoDay | null {
  const namesByDate = new Map<IsoDay, Set<string>>();
  for (const day of days) {
    if (day.date > today) continue;
    for (const activity of day.activities) {
      if (activity.kind !== kind || !activity.name) continue;
      const names = namesByDate.get(day.date) ?? new Set<string>();
      names.add(activity.name.trim());
      namesByDate.set(day.date, names);
    }
  }
  const dates = [...namesByDate.keys()].sort();
  if (!dates.length) return null;

  const first = dates[0];
  let latest: IsoDay | null = null;
  for (const date of dates) {
    if (daysBetween(first, date) < CHANGE_WARMUP_DAYS) continue;
    const prior = new Set<string>();
    for (const other of dates) {
      const gap = daysBetween(other, date);
      if (gap > 0 && gap <= CHANGE_LOOKBACK_DAYS) namesByDate.get(other)?.forEach((n) => prior.add(n));
    }
    if ([...(namesByDate.get(date) ?? [])].some((n) => !prior.has(n))) latest = date;
  }
  return latest;
}
