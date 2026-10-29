// "Programmed through": how many days of programming a client has left.
import { COVERAGE_BEYOND_HORIZON, NOTHING_SCHEDULED, PROGRAMMING_WARN_DAYS } from './constants';
import { daysBetween, daysUntil, formatDay, type IsoDay } from './dates';
import type { ClientFacts, CoverageAlert, HubAthlete, HubProgram } from './types';

export type Tone = 'bad' | 'warn' | 'ok' | 'muted' | 'none';

export type CoverageState =
  | 'scheduled' // has a last scheduled day within the horizon
  | 'beyond_horizon' // no alert → programmed 30+ days out
  | 'nothing_scheduled'
  | 'no_program' // linked, but no active 8ctane program
  | 'unavailable' // linked, but 8ctane data couldn't be read
  | 'manual' // unlinked, using the coach-entered "built until" date
  | 'not_linked';

export interface Coverage {
  state: CoverageState;
  /** Days until the last scheduled day; COVERAGE_BEYOND_HORIZON / NOTHING_SCHEDULED sentinels; null when unknown. */
  days: number | null;
  lastScheduledDate: IsoDay | null;
  label: string;
  tone: Tone;
  source: 'octane' | 'manual' | 'none';
}

/**
 * When an athlete has several programs, use: one I coach > a REMOTE one > the one ending latest.
 * `myOctaneUserUuid` is the coach whose view this is (or the client's owner during a server sync).
 */
export function pickProgram(athlete: HubAthlete | null, myOctaneUserUuid: string | null): HubProgram | null {
  if (!athlete || !athlete.programs.length) return null;
  const coachedByMe = (p: HubProgram) => (myOctaneUserUuid ? p.coaches.some((c) => c.userUuid === myOctaneUserUuid) : false);
  return [...athlete.programs].sort(
    (x, y) =>
      Number(coachedByMe(y)) - Number(coachedByMe(x)) ||
      Number(y.type === 'REMOTE') - Number(x.type === 'REMOTE') ||
      String(y.endDate ?? '').localeCompare(String(x.endDate ?? '')),
  )[0];
}

function daysTone(days: number): Tone {
  if (days < 0) return 'bad';
  if (days <= PROGRAMMING_WARN_DAYS) return 'warn';
  return 'none';
}

function datedLabel(day: IsoDay, days: number): string {
  return `${formatDay(day)} · ${days < 0 ? `${Math.abs(days)}d ago` : `${days}d`}`;
}

/**
 * @param program  result of pickProgram for the linked athlete (null if unlinked or no program)
 * @param coverage alerts map, or null when 8ctane couldn't be read
 * @param athletesLoaded false when the athlete list couldn't be read (so "no program" isn't trustworthy)
 */
export function coverageFor(
  client: Pick<ClientFacts, 'octaneAthleteUuid' | 'builtUntil'>,
  program: HubProgram | null,
  coverage: Map<string, CoverageAlert> | null,
  athletesLoaded: boolean,
  today: IsoDay,
): Coverage {
  if (client.octaneAthleteUuid) {
    if (!athletesLoaded || !coverage) {
      return { state: 'unavailable', days: null, lastScheduledDate: null, label: 'Unavailable', tone: 'muted', source: 'octane' };
    }
    if (!program) {
      return { state: 'no_program', days: null, lastScheduledDate: null, label: 'No active program', tone: 'warn', source: 'octane' };
    }
    const alert = coverage.get(program.uuid);
    if (!alert) {
      return { state: 'beyond_horizon', days: COVERAGE_BEYOND_HORIZON, lastScheduledDate: null, label: '30+ days out', tone: 'none', source: 'octane' };
    }
    if (!alert.lastScheduledDate) {
      return { state: 'nothing_scheduled', days: NOTHING_SCHEDULED, lastScheduledDate: null, label: 'Nothing scheduled', tone: 'bad', source: 'octane' };
    }
    const days = alert.daysUntilLastScheduledDay ?? daysBetween(today, alert.lastScheduledDate);
    return { state: 'scheduled', days, lastScheduledDate: alert.lastScheduledDate, label: datedLabel(alert.lastScheduledDate, days), tone: daysTone(days), source: 'octane' };
  }
  if (client.builtUntil) {
    const days = daysUntil(client.builtUntil, today) as number;
    return { state: 'manual', days, lastScheduledDate: client.builtUntil, label: datedLabel(client.builtUntil, days), tone: daysTone(days), source: 'manual' };
  }
  return { state: 'not_linked', days: null, lastScheduledDate: null, label: 'Not linked', tone: 'muted', source: 'none' };
}
