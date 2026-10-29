import { describe, expect, test } from 'vitest';
import { athlete, client, day, sets } from './fixtures';
import { buildSyncPatch, calendarWindow, needsSync, runPool } from './sync';

const today = '2026-10-21';
const now = new Date('2026-10-21T16:00:00Z');

describe('needsSync', () => {
  test('should sync active linked clients older than 6 hours only', () => {
    expect(needsSync(client({ octaneAthleteUuid: 'a' }), now)).toBe(true);
    expect(needsSync(client({ octaneAthleteUuid: 'a', syncedAt: '2026-10-21T11:00:00Z' }), now)).toBe(false);
    expect(needsSync(client({ octaneAthleteUuid: 'a', syncedAt: '2026-10-21T09:59:00Z' }), now)).toBe(true);
    expect(needsSync(client({ octaneAthleteUuid: 'a', status: 'PAUSED' }), now)).toBe(false);
    expect(needsSync(client(), now)).toBe(false);
  });
});

describe('calendarWindow', () => {
  test('should read six weeks back and one week ahead', () => {
    expect(calendarWindow(today)).toEqual({ startDate: '2026-09-10', endDate: '2026-10-28' });
  });
});

describe('buildSyncPatch', () => {
  const program = athlete('a', 'A', [{ type: 'REMOTE', coaches: [{ userUuid: null, name: 'Ryan Chasse' }] }]).programs[0];
  const days = [
    day('2026-09-20', [{ kind: 'lift', name: 'Phase 1', completion: sets(0, 20, 20) }]),
    day('2026-10-12', [{ kind: 'lift', name: 'Phase 2', completion: sets(0, 20, 20) }]),
    day('2026-10-20', [{ kind: 'plyo', name: 'Plyo +1', completion: sets(3, 6) }]),
    day('2026-10-22', [{ kind: 'plyo', name: 'Plyo +1', completion: sets(0, 6) }]), // future: ignored
  ];

  test('should fill empty program type and coach, and move dates forward from 8ctane', () => {
    const p = buildSyncPatch(client(), program, days, today, now);
    expect(p).toMatchObject({
      programType: 'REMOTE', coachName: 'Ryan Chasse', updLifts: '2026-10-12', updLiftsSource: 'OCTANE',
      weekDone: 3, weekTrackable: 6, lastTick: '2026-10-20', syncedAt: now.toISOString(),
    });
    expect(p.updPlyos).toBeUndefined(); // plyos only seen in the first week of data
  });
  test('should never overwrite a coach-entered value or move a date backward', () => {
    const p = buildSyncPatch(client({ programType: 'HYBRID', coachName: 'Max', updLifts: '2026-10-15' }), program, days, today, now);
    expect(p.programType).toBeUndefined();
    expect(p.coachName).toBeUndefined();
    expect(p.updLifts).toBeUndefined();
  });
  test('should keep the previous last tick when nothing new was ticked', () => {
    expect(buildSyncPatch(client({ lastTick: '2026-08-01' }), null, [], today, now).lastTick).toBe('2026-08-01');
  });
});

describe('runPool', () => {
  test('should cap concurrency and keep going past failures', async () => {
    let inFlight = 0;
    let peak = 0;
    const result = await runPool([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (n === 3) throw new Error('boom');
    });
    expect(peak).toBe(2);
    expect(result.ok).toBe(4);
    expect(result.failed.map((f) => f.item)).toEqual([3]);
  });
});
