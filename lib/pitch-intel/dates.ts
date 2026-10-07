import { TIME_ZONE } from "./config";

/** Today's date (YYYY-MM-DD) in Eastern time. */
export function todayET(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

export function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

export function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** Days between two YYYY-MM-DD dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** Splits [from, to] into two halves for re-requesting a range that hit Savant's row cap. */
export function splitRange(from: string, to: string): [[string, string], [string, string]] | null {
  const span = daysBetween(from, to);
  if (span < 1) return null;
  const mid = addDays(from, Math.floor(span / 2));
  return [
    [from, mid],
    [addDays(mid, 1), to],
  ];
}
