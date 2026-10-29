// Attention flags, list rows, filtering, sorting and headline stats for the client table.
import { CONTRACT_WARN_DAYS, NO_COVERAGE_SORT, PROGRAMMING_WARN_DAYS, UPDATE_FIELDS, UPDATE_STALE_DAYS, UPDATE_WARN_DAYS } from './constants';
import type { Coverage, Tone } from './coverage';
import { daysSince, daysUntil, type IsoDay } from './dates';
import type { ClientFacts, ClientStatus } from './types';

export const FOCUSES = ['program', 'quiet', 'updates', 'onboarding', 'contract', 'review'] as const;
export type Focus = (typeof FOCUSES)[number];

export type OnboardingStep = 'Assessment' | '3D' | 'Review';

/** Age in days of the stalest of plyos / lifts / delivery; null if any of them was never set. */
export function oldestUpdateAge(c: ClientFacts, today: IsoDay): number | null {
  const ages = UPDATE_FIELDS.map((f) => daysSince(c[f], today));
  if (ages.some((a) => a === null)) return null;
  return Math.max(...(ages as number[]));
}

/** Any of plyos / lifts / delivery unset or older than 42 days. */
export function isUpdatesDue(c: ClientFacts, today: IsoDay): boolean {
  return UPDATE_FIELDS.some((f) => {
    const age = daysSince(c[f], today);
    return age === null || age > UPDATE_STALE_DAYS;
  });
}

export function missingOnboarding(c: ClientFacts): OnboardingStep[] {
  const steps: [OnboardingStep, boolean][] = [
    ['Assessment', c.onbAssessment],
    ['3D', c.onb3d],
    ['Review', c.onbReview],
  ];
  return steps.filter(([, done]) => !done).map(([step]) => step);
}

/** Contract ends within 30 days — includes contracts that already ended. */
export function isContractEnding(c: ClientFacts, today: IsoDay): boolean {
  const d = daysUntil(c.contractEnd, today);
  return d !== null && d <= CONTRACT_WARN_DAYS;
}

/** Days ≤ 7 includes overdue and "nothing scheduled" (−1); "30+" (999) and unknown (null) don't count. */
export function isProgramRunningOut(coverage: Coverage): boolean {
  return coverage.days !== null && coverage.days <= PROGRAMMING_WARN_DAYS;
}

export interface WeekCheckoffs {
  done: number;
  trackable: number;
  lastTick: IsoDay | null;
}

export interface ClientRow {
  id: string;
  name: string;
  status: ClientStatus;
  phase: string | null;
  info: string; // "position · team · program type"
  coachName: string | null;
  needsReview: boolean;
  isMine: boolean;
  coverage: Coverage;
  /** null = not linked or never synced. trackable 0 = "Nothing to tick". */
  week: WeekCheckoffs | null;
  weekTone: Tone;
  oldestUpdateDays: number | null;
  oldestUpdateTone: Tone;
  updatesDue: boolean;
  onboardingMissing: OnboardingStep[];
  contractEnd: IsoDay | null;
  contractEndsInDays: number | null;
  contractTone: Tone;
}

function updateAgeTone(age: number | null): Tone {
  if (age === null) return 'warn';
  if (age > UPDATE_STALE_DAYS) return 'bad';
  if (age > UPDATE_WARN_DAYS) return 'warn';
  return 'none';
}

function contractTone(days: number | null): Tone {
  if (days === null) return 'muted';
  if (days < 0) return 'bad';
  if (days <= CONTRACT_WARN_DAYS) return 'warn';
  return 'none';
}

const PROGRAM_TYPE_LABEL = { REMOTE: 'Remote', HYBRID: 'Hybrid', IN_HOUSE: 'In house' } as const;

export function buildRow(c: ClientFacts, coverage: Coverage, isMine: boolean, today: IsoDay): ClientRow {
  const week = c.octaneAthleteUuid && c.syncedAt
    ? { done: c.weekDone ?? 0, trackable: c.weekTrackable ?? 0, lastTick: c.lastTick }
    : null;
  const oldest = oldestUpdateAge(c, today);
  const contractDays = daysUntil(c.contractEnd, today);
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    phase: c.phase,
    info: [c.position, c.team, c.programType ? PROGRAM_TYPE_LABEL[c.programType] : null].filter(Boolean).join(' · '),
    coachName: c.coachName,
    needsReview: c.needsReview,
    isMine,
    coverage,
    week,
    weekTone: week && week.trackable > 0 && week.done === 0 ? 'bad' : 'none',
    oldestUpdateDays: oldest,
    oldestUpdateTone: updateAgeTone(oldest),
    updatesDue: isUpdatesDue(c, today),
    onboardingMissing: missingOnboarding(c),
    contractEnd: c.contractEnd,
    contractEndsInDays: contractDays,
    contractTone: contractTone(contractDays),
  };
}

export function matchesFocus(row: ClientRow, focus: Focus | null): boolean {
  switch (focus) {
    case 'program':
      return isProgramRunningOut(row.coverage);
    case 'quiet':
      return !!row.week && row.week.trackable > 0 && row.week.done === 0;
    case 'updates':
      return row.updatesDue;
    case 'onboarding':
      return row.onboardingMissing.length > 0;
    case 'contract':
      return row.contractEndsInDays !== null && row.contractEndsInDays <= CONTRACT_WARN_DAYS;
    case 'review':
      return row.needsReview;
    default:
      return true;
  }
}

export interface ListFilter {
  status: ClientStatus | 'ALL';
  focus: Focus | null;
  query: string; // matched against name, team, coach, phase
}

export function filterAndSort(rows: ClientRow[], clients: Map<string, ClientFacts>, filter: ListFilter): ClientRow[] {
  const q = filter.query.trim().toLowerCase();
  return rows
    .filter((row) => {
      if (filter.status !== 'ALL' && row.status !== filter.status) return false;
      if (q) {
        const c = clients.get(row.id);
        const haystack = [row.name, c?.team, row.coachName, row.phase].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return matchesFocus(row, filter.focus);
    })
    .sort((a, b) => (a.coverage.days ?? NO_COVERAGE_SORT) - (b.coverage.days ?? NO_COVERAGE_SORT) || a.name.localeCompare(b.name));
}

export interface HeadlineStats {
  activeClients: number;
  programmingEndsIn7Days: number;
  onboardingOpen: number;
  toReview: number; // across every status
}

/** Computed over the scoped rows (mine / all) before status and focus filters. */
export function headlineStats(rows: ClientRow[]): HeadlineStats {
  const active = rows.filter((r) => r.status === 'ACTIVE');
  return {
    activeClients: active.length,
    programmingEndsIn7Days: active.filter((r) => isProgramRunningOut(r.coverage)).length,
    onboardingOpen: active.filter((r) => r.onboardingMissing.length > 0).length,
    toReview: rows.filter((r) => r.needsReview).length,
  };
}
