import { describe, expect, test } from 'vitest';
import type { Coverage } from './coverage';
import { client, day, sets } from './fixtures';
import { buildAppCard } from './profile';

const coverage: Coverage = { state: 'beyond_horizon', days: 999, lastScheduledDate: null, label: '30+ days out', tone: 'none', source: 'octane' };

describe('buildAppCard', () => {
  test('should build a 14-day strip ending today and the next 7 days', () => {
    const days = [
      day('2026-10-07', [{ kind: 'plyo', name: 'P', completion: sets(9, 9) }]), // 14 days back: just outside the strip
      day('2026-10-20', [{ kind: 'plyo', name: 'P', completion: sets(3, 6) }]),
      day('2026-10-23', [{ kind: 'bulletProofing', name: null, completion: null }]),
    ];
    const card = buildAppCard(client({ contractStart: '2026-10-01' }), null, coverage, days, '2026-10-21');
    expect(card.strip).toHaveLength(14);
    expect(card.strip[0].date).toBe('2026-10-08');
    expect(card.strip.at(-1)).toMatchObject({ date: '2026-10-21', isToday: true, share: null });
    expect(card.strip.find((s) => s.date === '2026-10-20')?.share).toBe(0.5);
    expect(card.last14).toEqual({ done: 3, trackable: 6, lastTick: '2026-10-20' });
    expect(card.upcoming[1]).toEqual({ date: '2026-10-23', activities: [{ kind: 'bulletProofing', label: 'Arm care', name: null }] });
    expect(card.daysSinceContractStart).toBe(20);
  });
});
