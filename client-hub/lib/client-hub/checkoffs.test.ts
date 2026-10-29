import { describe, expect, test } from 'vitest';
import { lastNewSessionDate, lastWeek, tally } from './checkoffs';
import { addDays } from './dates';
import { day, sets } from './fixtures';

describe('tally', () => {
  test('should count only flagged sets and skip untracked activities', () => {
    const t = tally([
      day('2026-10-19', [
        { kind: 'lift', name: 'Total', completion: sets(0, 24, 24) }, // no per-set flags → 0 trackable
        { kind: 'plyo', name: 'Plyo +1', completion: sets(5, 5) },
        { kind: 'throwing', name: 'Catch Play', completion: null },
      ]),
      day('2026-10-20', [{ kind: 'prep', name: null, completion: sets(0, 12) }]),
    ]);
    expect(t).toEqual({ done: 5, trackable: 17, lastTick: '2026-10-19' });
  });
});

describe('lastWeek', () => {
  test('should include today and the six days before it', () => {
    const days = ['2026-10-14', '2026-10-15', '2026-10-21', '2026-10-22'].map((d) => day(d, []));
    expect(lastWeek(days, '2026-10-21').map((d) => d.date)).toEqual(['2026-10-15', '2026-10-21']);
  });
});

describe('lastNewSessionDate', () => {
  const today = '2026-10-21';
  const plyo = (date: string, name: string) => day(date, [{ kind: 'plyo', name, completion: null }]);

  test('should return the latest day a never-before-seen session name appeared', () => {
    const days = [plyo('2026-09-20', 'Plyo A'), plyo('2026-09-30', 'Plyo A'), plyo('2026-10-10', 'Plyo B'), plyo('2026-10-15', 'Plyo B')];
    expect(lastNewSessionDate(days, 'plyo', today)).toBe('2026-10-10');
  });
  test('should ignore the first week of data', () => {
    expect(lastNewSessionDate([plyo('2026-10-15', 'A'), plyo('2026-10-18', 'B')], 'plyo', today)).toBeNull();
  });
  test('should treat a name unseen for 21+ days as new again', () => {
    const days = [plyo('2026-09-01', 'A'), plyo('2026-09-09', 'B'), plyo('2026-10-01', 'A')];
    expect(lastNewSessionDate(days, 'plyo', today)).toBe('2026-10-01');
  });
  test('should ignore future days and other kinds', () => {
    const days = [plyo('2026-09-20', 'A'), plyo(addDays(today, 2), 'Z'), day('2026-10-10', [{ kind: 'lift', name: 'New', completion: null }])];
    expect(lastNewSessionDate(days, 'plyo', today)).toBeNull();
  });
});
