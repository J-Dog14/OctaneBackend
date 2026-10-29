// Calendar-day math on 'YYYY-MM-DD' strings. All arithmetic is done in UTC so DST never shifts a day.
import { HUB_TIMEZONE } from './constants';

export type IsoDay = string;

const DAY_MS = 86_400_000;

export function todayIso(now: Date = new Date(), timeZone: string = HUB_TIMEZONE): IsoDay {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function utcMs(day: IsoDay): number {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(day: IsoDay, n: number): IsoDay {
  return new Date(utcMs(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: IsoDay, to: IsoDay): number {
  return Math.round((utcMs(to) - utcMs(from)) / DAY_MS);
}

/** Days until `day` from today; null when unset. Negative = in the past. */
export function daysUntil(day: IsoDay | null, today: IsoDay): number | null {
  return day ? daysBetween(today, day) : null;
}

/** Days since `day`; null when unset. */
export function daysSince(day: IsoDay | null, today: IsoDay): number | null {
  return day ? daysBetween(day, today) : null;
}

/** Prisma @db.Date → 'YYYY-MM-DD'. */
export function toIsoDay(value: Date | null | undefined): IsoDay | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** 'YYYY-MM-DD' → Date at UTC midnight, for Prisma @db.Date. */
export function fromIsoDay(day: IsoDay | null | undefined): Date | null {
  return day ? new Date(utcMs(day)) : null;
}

/** "Oct 24" (or "Oct 24, 2026"). */
export function formatDay(day: IsoDay, withYear = false): string {
  return new Date(utcMs(day)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}
