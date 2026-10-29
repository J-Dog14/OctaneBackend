import { describe, expect, test } from 'vitest';
import type { Coverage } from './coverage';
import { client } from './fixtures';
import { buildRow, filterAndSort, headlineStats, isUpdatesDue, matchesFocus, oldestUpdateAge } from './flags';

const today = '2026-10-21';
const cov = (days: number | null): Coverage => ({ state: 'scheduled', days, lastScheduledDate: null, label: '', tone: 'none', source: 'octane' });

describe('update ages', () => {
  test('should be null and due when any of plyos/lifts/delivery is unset', () => {
    const c = client({ updPlyos: '2026-10-20', updLifts: '2026-10-20' });
    expect(oldestUpdateAge(c, today)).toBeNull();
    expect(isUpdatesDue(c, today)).toBe(true);
  });
  test('should go amber after 28 days and red after 42', () => {
    const at = (age: number) => buildRow(client({ updPlyos: '2026-10-20', updLifts: '2026-10-20', updDelivery: shift(-age) }), cov(null), true, today);
    expect(at(28).oldestUpdateTone).toBe('none');
    expect(at(29).oldestUpdateTone).toBe('warn');
    expect(at(42)).toMatchObject({ oldestUpdateTone: 'warn', updatesDue: false });
    expect(at(43)).toMatchObject({ oldestUpdateTone: 'bad', updatesDue: true });
  });
});

function shift(n: number) {
  const d = new Date(Date.UTC(2026, 9, 21 + n));
  return d.toISOString().slice(0, 10);
}

describe('focus filters', () => {
  test('program: ≤7 days, overdue and nothing-scheduled count; 30+ and unknown do not', () => {
    for (const [days, expected] of [[7, true], [-4, true], [-1, true], [8, false], [999, false], [null, false]] as const) {
      expect(matchesFocus(buildRow(client(), cov(days), true, today), 'program')).toBe(expected);
    }
  });
  test('quiet: trackable sets this week but none ticked', () => {
    const synced = { octaneAthleteUuid: 'a', syncedAt: '2026-10-21T12:00:00Z' };
    expect(matchesFocus(buildRow(client({ ...synced, weekDone: 0, weekTrackable: 40 }), cov(null), true, today), 'quiet')).toBe(true);
    expect(matchesFocus(buildRow(client({ ...synced, weekDone: 0, weekTrackable: 0 }), cov(null), true, today), 'quiet')).toBe(false);
    expect(matchesFocus(buildRow(client({ weekDone: 0, weekTrackable: 40 }), cov(null), true, today), 'quiet')).toBe(false); // unlinked
  });
  test('contract: ends within 30 days, including already ended', () => {
    expect(matchesFocus(buildRow(client({ contractEnd: '2026-11-20' }), cov(null), true, today), 'contract')).toBe(true);
    expect(matchesFocus(buildRow(client({ contractEnd: '2026-01-01' }), cov(null), true, today), 'contract')).toBe(true);
    expect(matchesFocus(buildRow(client({ contractEnd: '2026-11-21' }), cov(null), true, today), 'contract')).toBe(false);
  });
  test('onboarding: any of assessment, 3D, review missing', () => {
    const row = buildRow(client({ onbAssessment: true }), cov(null), true, today);
    expect(row.onboardingMissing).toEqual(['3D', 'Review']);
    expect(matchesFocus(row, 'onboarding')).toBe(true);
  });
});

describe('filterAndSort', () => {
  test('should sort by days of programming left, unknowns after real numbers, then by name', () => {
    const cs = [client({ id: '1', name: 'Zed' }), client({ id: '2', name: 'Amy' }), client({ id: '3', name: 'Bo' }), client({ id: '4', name: 'Cy' })];
    const days = [3, null, 3, 999];
    const rows = cs.map((c, i) => buildRow(c, cov(days[i]), true, today));
    const sorted = filterAndSort(rows, new Map(cs.map((c) => [c.id, c])), { status: 'ACTIVE', focus: null, query: '' });
    expect(sorted.map((r) => r.name)).toEqual(['Bo', 'Zed', 'Amy', 'Cy']);
  });
  test('should search name, team, coach and phase', () => {
    const c = client({ team: 'NC State' });
    const rows = [buildRow(c, cov(null), true, today)];
    expect(filterAndSort(rows, new Map([[c.id, c]]), { status: 'ALL', focus: null, query: 'state' })).toHaveLength(1);
  });
});

describe('headlineStats', () => {
  test('should count active clients, but To review across every status', () => {
    const rows = [
      buildRow(client({ status: 'ACTIVE' }), cov(2), true, today),
      buildRow(client({ status: 'PAUSED', needsReview: true }), cov(2), true, today),
    ];
    expect(headlineStats(rows)).toEqual({ activeClients: 1, programmingEndsIn7Days: 1, onboardingOpen: 1, toReview: 1 });
  });
});
