import { describe, expect, test } from 'vitest';
import { addDays, daysBetween, formatDay, fromIsoDay, todayIso, toIsoDay } from './dates';

describe('dates', () => {
  test('should use the gym timezone, not UTC, for today', () => {
    // 02:30 UTC on Oct 22 is still Oct 21 in Raleigh
    expect(todayIso(new Date('2026-10-22T02:30:00Z'))).toBe('2026-10-21');
  });
  test('should step across DST and month ends', () => {
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-21', '2026-11-20')).toBe(30);
  });
  test('should round-trip Prisma @db.Date values', () => {
    expect(toIsoDay(fromIsoDay('2026-10-21'))).toBe('2026-10-21');
    expect(fromIsoDay(null)).toBeNull();
  });
  test('should format short dates', () => {
    expect(formatDay('2026-10-24')).toBe('Oct 24');
    expect(formatDay('2026-10-24', true)).toBe('Oct 24, 2026');
  });
});
