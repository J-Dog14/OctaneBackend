import { describe, expect, test } from 'vitest';
import { coverageFor, pickProgram } from './coverage';
import { athlete, client, ME } from './fixtures';
import type { CoverageAlert } from './types';

const today = '2026-10-21';
const alerts = (...a: CoverageAlert[]) => new Map(a.map((x) => [x.programUuid, x]));

describe('pickProgram', () => {
  test('should prefer my program, then REMOTE, then the latest end date', () => {
    const a = athlete('a', 'A', [
      { uuid: 'inhouse-late', type: 'IN_HOUSE', endDate: '2027-09-01' },
      { uuid: 'remote-early', type: 'REMOTE', endDate: '2026-12-01' },
      { uuid: 'remote-late', type: 'REMOTE', endDate: '2027-03-01' },
    ]);
    expect(pickProgram(a, null)?.uuid).toBe('remote-late');
    const mine = athlete('a', 'A', [...a.programs, { uuid: 'mine', name: 'x', type: 'IN_HOUSE', endDate: null, coaches: [{ userUuid: ME, name: 'Me' }] }]);
    expect(pickProgram(mine, ME)?.uuid).toBe('mine');
  });
});

describe('coverageFor', () => {
  const linked = client({ octaneAthleteUuid: 'a' });
  const program = athlete('a', 'A', [{ uuid: 'p' }]).programs[0];

  test('should flag 3 days left as warn', () => {
    const c = coverageFor(linked, program, alerts({ programUuid: 'p', lastScheduledDate: '2026-10-24', daysUntilLastScheduledDay: 3 }), true, today);
    expect(c).toMatchObject({ state: 'scheduled', days: 3, tone: 'warn', label: 'Oct 24 · 3d' });
  });
  test('should flag overdue programming as bad', () => {
    const c = coverageFor(linked, program, alerts({ programUuid: 'p', lastScheduledDate: '2026-10-18', daysUntilLastScheduledDay: -3 }), true, today);
    expect(c).toMatchObject({ days: -3, tone: 'bad', label: 'Oct 18 · 3d ago' });
  });
  test('should read a missing alert as programmed 30+ days out', () => {
    expect(coverageFor(linked, program, alerts(), true, today)).toMatchObject({ state: 'beyond_horizon', days: 999 });
  });
  test('should flag a program with nothing scheduled', () => {
    const c = coverageFor(linked, program, alerts({ programUuid: 'p', lastScheduledDate: null, daysUntilLastScheduledDay: null }), true, today);
    expect(c).toMatchObject({ state: 'nothing_scheduled', days: -1, tone: 'bad' });
  });
  test('should say unavailable rather than guess when 8ctane is down', () => {
    expect(coverageFor(linked, program, null, true, today).state).toBe('unavailable');
    expect(coverageFor(linked, null, alerts(), false, today).state).toBe('unavailable');
  });
  test('should fall back to the manual built-until date when unlinked', () => {
    expect(coverageFor(client({ builtUntil: '2026-11-01' }), null, null, false, today)).toMatchObject({ state: 'manual', days: 11, tone: 'none' });
    expect(coverageFor(client(), null, null, false, today).state).toBe('not_linked');
  });
});
