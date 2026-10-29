// List rows for the hub table: programming coverage, attention flags, filters, sorting, headline stats. Pure.
import {
  ASSESSMENT_STALE_DAYS, CONTRACT_WARN_DAYS, PERIOD_ENDING_DAYS, PROGRAM_TYPE_LABEL, PROGRAMMING_WARN_DAYS,
  UPDATE_FIELDS, UPDATE_STALE_DAYS, UPDATE_WARN_DAYS, type ClientStatus, type ProgramType,
} from './constants';
import { daysSince, daysUntil, formatDay, type IsoDay } from './dates';
import type { ChecklistItem } from './assessmentRules';
import type { HubClient } from './types';

export type Tone = 'bad' | 'warn' | 'ok' | 'muted' | 'none';

export const FOCUSES = ['program', 'ending', 'quiet', 'updates', 'onboarding', 'assessment', 'contract', 'review'] as const;
export type Focus = (typeof FOCUSES)[number];
export type OnboardingStep = 'Assessment' | '3D' | 'Review';

export interface Coverage {
  /** Days until the last scheduled day with work; negative = ran out; null = unknown / not active. */
  days: number | null;
  lastScheduled: IsoDay | null;
  label: string;
  tone: Tone;
}

/** "Programmed through": the last day with work in a current program. */
export function coverageFor(c: Pick<HubClient, 'isActive' | 'lastScheduled' | 'syncedAt' | 'appUserId'>, today: IsoDay): Coverage {
  if (!c.isActive) return { days: null, lastScheduled: c.lastScheduled, label: '—', tone: 'muted' };
  if (!c.appUserId) return { days: null, lastScheduled: null, label: 'Not in the app', tone: 'muted' };
  if (!c.syncedAt) return { days: null, lastScheduled: null, label: 'Not synced yet', tone: 'muted' };
  if (!c.lastScheduled) return { days: -1, lastScheduled: null, label: 'Nothing scheduled', tone: 'bad' };
  const days = daysUntil(c.lastScheduled, today)!;
  const label = `${formatDay(c.lastScheduled)} · ${days < 0 ? `${-days}d ago` : `${days}d`}`;
  return { days, lastScheduled: c.lastScheduled, label, tone: days < 0 ? 'bad' : days <= PROGRAMMING_WARN_DAYS ? 'warn' : 'none' };
}

export function oldestUpdateAge(c: HubClient, today: IsoDay): number | null {
  const ages = UPDATE_FIELDS.map((f) => daysSince(c[f], today));
  if (ages.some((a) => a === null)) return null;
  return Math.max(...(ages as number[]));
}

export function isUpdatesDue(c: HubClient, today: IsoDay): boolean {
  return UPDATE_FIELDS.some((f) => {
    const age = daysSince(c[f], today);
    return age === null || age > UPDATE_STALE_DAYS;
  });
}

export interface Onboarding {
  assessment: boolean;
  threeD: boolean;
  review: boolean;
  /** Which ticks came from the warehouse rather than a coach. */
  auto: { assessment: boolean; threeD: boolean };
}

export function onboardingFor(c: HubClient, auto: { assessment: boolean; threeD: boolean }): Onboarding {
  return {
    assessment: c.onbAssessment || auto.assessment,
    threeD: c.onb3d || auto.threeD,
    review: c.onbReview,
    auto: { assessment: !c.onbAssessment && auto.assessment, threeD: !c.onb3d && auto.threeD },
  };
}

export function missingOnboarding(o: Onboarding): OnboardingStep[] {
  return ([['Assessment', o.assessment], ['3D', o.threeD], ['Review', o.review]] as const).filter(([, ok]) => !ok).map(([s]) => s);
}

export interface ClientRow {
  id: string;
  athleteUuid: string | null;
  name: string;
  status: ClientStatus;
  statusOverride: ClientStatus | null;
  phase: string | null;
  info: string; // "position · team"
  programType: ProgramType | null;
  programTypeLabel: string | null;
  programName: string | null;
  coachNames: string;
  periodStart: IsoDay | null;
  periodEnd: IsoDay | null;
  periodDaysLeft: number | null;
  periodTone: Tone;
  periodCount: number;
  clientSince: IsoDay | null;
  isMine: boolean;
  needsReview: boolean;
  linkReview: boolean;
  coverage: Coverage;
  week: { done: number; trackable: number; lastTick: IsoDay | null } | null;
  weekTone: Tone;
  oldestUpdateDays: number | null;
  oldestUpdateTone: Tone;
  updatesDue: boolean;
  onboardingMissing: OnboardingStep[];
  lastAssessment: IsoDay | null;
  /** Mobility / Proteus / 3D / Athletic screen for the current (or latest) program. */
  checklist: ChecklistItem[];
  nextAssessmentDue: IsoDay | null;
  assessmentDue: boolean;
  assessmentTone: Tone;
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

export function buildRow(
  c: HubClient,
  extra: { onboarding: Onboarding; lastAssessment: IsoDay | null; checklist: ChecklistItem[]; isMine: boolean },
  today: IsoDay,
): ClientRow {
  const active = c.status === 'active';
  const week = c.appUserId && c.syncedAt && active ? { done: c.weekDone ?? 0, trackable: c.weekTrackable ?? 0, lastTick: c.lastTick } : null;
  const oldest = oldestUpdateAge(c, today);
  const contractDays = daysUntil(c.contractEnd, today);
  const sinceAssessment = daysSince(extra.lastAssessment, today);
  const dueIn = daysUntil(c.nextAssessmentDue, today);
  const assessmentDue = active && (dueIn !== null ? dueIn <= 0 : sinceAssessment === null || sinceAssessment > ASSESSMENT_STALE_DAYS);
  const periodDaysLeft = c.periodDaysLeft;
  return {
    id: c.id,
    athleteUuid: c.athleteUuid,
    name: c.name,
    status: c.status,
    statusOverride: c.statusOverride,
    phase: c.phase,
    info: [c.position, c.team].filter(Boolean).join(' · '),
    programType: c.programType,
    programTypeLabel: c.programType ? PROGRAM_TYPE_LABEL[c.programType] : null,
    programName: c.programName,
    coachNames: c.coachName || c.programCoaches.join(', '),
    periodStart: c.periodStart,
    periodEnd: c.periodEnd,
    periodDaysLeft,
    periodTone: !active || periodDaysLeft === null ? 'none' : periodDaysLeft < 0 ? 'bad' : periodDaysLeft <= PERIOD_ENDING_DAYS ? 'warn' : 'none',
    periodCount: c.periodCount,
    clientSince: c.clientSince,
    isMine: extra.isMine,
    needsReview: c.needsReview,
    linkReview: c.linkReview,
    coverage: coverageFor(c, today),
    week,
    weekTone: week && week.trackable > 0 && week.done === 0 ? 'bad' : 'none',
    oldestUpdateDays: oldest,
    oldestUpdateTone: active ? updateAgeTone(oldest) : 'none',
    updatesDue: active && isUpdatesDue(c, today),
    onboardingMissing: active ? missingOnboarding(extra.onboarding) : [],
    lastAssessment: extra.lastAssessment,
    checklist: extra.checklist,
    nextAssessmentDue: c.nextAssessmentDue,
    assessmentDue,
    assessmentTone: assessmentDue ? 'warn' : 'none',
    contractEnd: c.contractEnd,
    contractEndsInDays: contractDays,
    contractTone: contractDays === null ? 'muted' : contractDays < 0 ? 'bad' : contractDays <= CONTRACT_WARN_DAYS ? 'warn' : 'none',
  };
}

export function matchesFocus(row: ClientRow, focus: Focus | null): boolean {
  switch (focus) {
    case 'program':
      return row.status === 'active' && row.coverage.days !== null && row.coverage.days <= PROGRAMMING_WARN_DAYS;
    case 'ending':
      return row.status === 'active' && row.periodDaysLeft !== null && row.periodDaysLeft <= PERIOD_ENDING_DAYS;
    case 'quiet':
      return !!row.week && row.week.trackable > 0 && row.week.done === 0;
    case 'updates':
      return row.updatesDue;
    case 'onboarding':
      return row.onboardingMissing.length > 0;
    case 'assessment':
      return row.assessmentDue;
    case 'contract':
      return row.contractEndsInDays !== null && row.contractEndsInDays <= CONTRACT_WARN_DAYS;
    case 'review':
      return row.needsReview || row.linkReview;
    default:
      return true;
  }
}

export interface ListFilter {
  status: ClientStatus | 'all';
  types: ProgramType[]; // empty = all
  focus: Focus | null;
  query: string; // name, team, coach, phase, program
}

const NO_COVERAGE_SORT = 500;

export function filterAndSort(rows: ClientRow[], filter: ListFilter): ClientRow[] {
  const q = filter.query.trim().toLowerCase();
  return rows
    .filter((row) => {
      if (filter.status !== 'all' && row.status !== filter.status) return false;
      if (filter.types.length && (!row.programType || !filter.types.includes(row.programType))) return false;
      if (q && ![row.name, row.info, row.coachNames, row.phase, row.programName].filter(Boolean).join(' ').toLowerCase().includes(q)) return false;
      return matchesFocus(row, filter.focus);
    })
    .sort((a, b) => {
      if (a.status === 'active' && b.status === 'active') {
        return (a.coverage.days ?? NO_COVERAGE_SORT) - (b.coverage.days ?? NO_COVERAGE_SORT) || a.name.localeCompare(b.name);
      }
      if (a.status !== b.status) return ['active', 'paused', 'expired'].indexOf(a.status) - ['active', 'paused', 'expired'].indexOf(b.status);
      return String(b.periodEnd ?? '').localeCompare(String(a.periodEnd ?? '')) || a.name.localeCompare(b.name);
    });
}

export interface HeadlineStats {
  active: number;
  paused: number;
  expired: number;
  programmingEnds7: number;
  periodsEnding: number;
  onboardingOpen: number;
  assessmentDue: number;
  toReview: number;
}

/** Over the scoped rows (mine / all, type filter) before status and focus filters. */
export function headlineStats(rows: ClientRow[]): HeadlineStats {
  const active = rows.filter((r) => r.status === 'active');
  return {
    active: active.length,
    paused: rows.filter((r) => r.status === 'paused').length,
    expired: rows.filter((r) => r.status === 'expired').length,
    programmingEnds7: active.filter((r) => matchesFocus(r, 'program')).length,
    periodsEnding: active.filter((r) => matchesFocus(r, 'ending')).length,
    onboardingOpen: active.filter((r) => r.onboardingMissing.length > 0).length,
    assessmentDue: active.filter((r) => r.assessmentDue).length,
    toReview: rows.filter((r) => r.needsReview || r.linkReview).length,
  };
}
