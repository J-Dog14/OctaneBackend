// Assessment status per kind, last assessment, onboarding auto-ticks. Pure (the warehouse reads are in assessments.ts).
import { ASSESSMENT_KINDS, ONBOARDING_3D_KINDS, ONBOARDING_ASSESSMENT_KINDS, ONBOARDING_LOOKBACK_DAYS, type AssessmentKind } from './constants';
import { addDays, type IsoDay } from './dates';
import type { AssessmentCheck } from './types';

export interface AssessmentStatus {
  kind: AssessmentKind;
  label: string;
  /** Latest session in the warehouse. */
  last: IsoDay | null;
  sessions: number;
  /** Warehouse sessions since the current period started. */
  inPeriod: IsoDay[];
  /** Latest coach entry of each status. */
  scheduled: IsoDay | null;
  doneManually: IsoDay | null;
  waived: boolean;
}

/** One line per assessment kind for the profile: warehouse sessions merged with coach entries. */
export function assessmentStatus(
  dates: Map<AssessmentKind, IsoDay[]> | undefined,
  checks: AssessmentCheck[],
  periodStart: IsoDay | null,
  today: IsoDay,
): AssessmentStatus[] {
  return ASSESSMENT_KINDS.map(({ id, label }) => {
    const d = dates?.get(id) ?? [];
    const mine = checks.filter((c) => c.kind === id);
    const latest = (s: AssessmentCheck['status']) => mine.filter((c) => c.status === s).map((c) => c.checkDate).sort().at(-1) ?? null;
    const scheduled = mine.filter((c) => c.status === 'scheduled' && c.checkDate >= addDays(today, -14)).map((c) => c.checkDate).sort()[0] ?? null;
    return {
      kind: id,
      label,
      last: d[0] ?? null,
      sessions: d.length,
      inPeriod: periodStart ? d.filter((x) => x >= periodStart) : [],
      scheduled,
      doneManually: latest('done'),
      waived: mine.some((c) => c.status === 'waived' && (!periodStart || c.checkDate >= periodStart)),
    };
  }).filter((s) => s.sessions > 0 || s.scheduled || s.doneManually || s.waived || s.kind === 'athletic_screen' || s.kind === 'mobility' || s.kind === 'pitching_3d');
}

/** Latest assessment of any kind (warehouse or marked done by a coach). */
export function lastAssessment(dates: Map<AssessmentKind, IsoDay[]> | undefined, checks: AssessmentCheck[] = []): IsoDay | null {
  const all = [...[...(dates?.values() ?? [])].map((d) => d[0]), ...checks.filter((c) => c.status === 'done').map((c) => c.checkDate)];
  return all.filter(Boolean).sort().at(-1) ?? null;
}

/**
 * The per-program assessment checklist: Mobility, Proteus, 3D, Athletic screen.
 * A box is checked when the warehouse has a session from 30 days before the current
 * program started onwards (auto), OR a coach checked it for this program (manual, e.g.
 * scheduled but not in the database yet). Either one counts.
 */
export const CHECKLIST: ReadonlyArray<{ kind: AssessmentKind; label: string; sources: AssessmentKind[] }> = [
  { kind: 'mobility', label: 'Mobility', sources: ['mobility'] },
  { kind: 'proteus', label: 'Proteus', sources: ['proteus'] },
  { kind: 'pitching_3d', label: '3D', sources: ['pitching_3d', 'hitting_3d'] },
  { kind: 'athletic_screen', label: 'Athletic screen', sources: ['athletic_screen'] },
];
export const CHECKLIST_KINDS = CHECKLIST.map((c) => c.kind);

export interface ChecklistItem {
  kind: AssessmentKind;
  label: string;
  done: boolean;
  /** Latest warehouse session counting for this program (null = none yet). */
  auto: IsoDay | null;
  /** When a coach checked it for this program (null = not checked by hand). */
  manual: IsoDay | null;
  manualBy: string | null;
  /** Latest session ever, for context. */
  last: IsoDay | null;
}

export function checklistFor(
  dates: Map<AssessmentKind, IsoDay[]> | undefined,
  checks: AssessmentCheck[],
  periodStart: IsoDay | null,
  periodId: number | null,
): ChecklistItem[] {
  const since = periodStart ? addDays(periodStart, -ONBOARDING_LOOKBACK_DAYS) : null;
  return CHECKLIST.map(({ kind, label, sources }) => {
    const sessions = sources.flatMap((k) => dates?.get(k) ?? []).sort().reverse();
    const auto = sessions.find((d) => !since || d >= since) ?? null;
    const manualCheck = checks
      .filter((c) => c.status === 'done' && (c.kind === kind || sources.includes(c.kind)))
      .filter((c) => (periodId != null && c.programId === periodId) || (c.programId == null && (!since || c.checkDate >= since)))
      .sort((a, b) => b.checkDate.localeCompare(a.checkDate))[0];
    return {
      kind, label, auto, last: sessions[0] ?? null,
      manual: manualCheck?.checkDate ?? null, manualBy: manualCheck?.createdBy ?? null,
      done: !!auto || !!manualCheck,
    };
  });
}

/** Onboarding Assessment / 3D follow the checklist: Assessment = mobility or athletic screen, 3D = 3D. */
export function autoOnboarding(checklist: ChecklistItem[]) {
  const done = (kinds: AssessmentKind[]) => checklist.some((c) => kinds.includes(c.kind) && c.done);
  return { assessment: done(ONBOARDING_ASSESSMENT_KINDS), threeD: done(ONBOARDING_3D_KINDS) };
}
