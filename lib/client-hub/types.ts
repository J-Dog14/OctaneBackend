import type { AssessmentKind, ClientStatus, ProgramType } from './constants';
import type { IsoDay } from './dates';

export type DateSource = 'app' | 'coach';
export type LinkMethod = 'app_db_uuid' | 'email' | 'name' | 'created' | 'coach';

/** A hub client as stored (coach.v_hub_clients), dates as 'YYYY-MM-DD'. */
export interface HubClient {
  id: string;
  athleteUuid: string | null;
  appUserId: string | null;
  name: string;
  email: string | null;
  linkMethod: LinkMethod | null;
  linkReview: boolean;
  linkCandidates: LinkCandidate[] | null;
  autoStatus: 'active' | 'expired';
  statusOverride: ClientStatus | null;
  status: ClientStatus;
  isActive: boolean;
  statusChangedAt: string | null;
  phase: string | null;
  scheduleNote: string | null;
  coachName: string | null;
  ownerClerkUserId: string | null;
  ownerName: string | null;
  throws: 'R' | 'L' | null;
  position: string | null;
  team: string | null;
  contractDuration: string | null;
  contractStart: IsoDay | null;
  contractEnd: IsoDay | null;
  contractStatus: 'SIGNED' | 'SENT' | 'NOT_SENT';
  onbAssessment: boolean;
  onb3d: boolean;
  onbReview: boolean;
  lastContacted: IsoDay | null;
  nextAssessmentDue: IsoDay | null;
  needsReview: boolean;
  updPlyos: IsoDay | null;
  updPlyosSource: DateSource | null;
  updLifts: IsoDay | null;
  updLiftsSource: DateSource | null;
  updDelivery: IsoDay | null;
  updDeliverySource: DateSource | null;
  weekDone: number | null;
  weekTrackable: number | null;
  lastTick: IsoDay | null;
  lastScheduled: IsoDay | null;
  syncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  // Current (or latest) period, from the view.
  periodId: number | null;
  programName: string | null;
  programType: ProgramType | null;
  programCoaches: string[];
  periodStart: IsoDay | null;
  periodEnd: IsoDay | null;
  periodSpanDays: number | null;
  periodDaysLeft: number | null;
  periodCount: number;
  clientSince: IsoDay | null;
}

export interface LinkCandidate {
  athleteUuid: string;
  name: string;
  score: number;
}

/** One program period (coach.hub_client_programs). */
export interface HubPeriod {
  id: number;
  clientId: string;
  source: 'app' | 'coach';
  appProgramId: number | null;
  name: string | null;
  programType: ProgramType | null;
  coachNames: string[];
  appStart: IsoDay | null;
  appEnd: IsoDay | null;
  appArchived: boolean;
  appFirstDay: IsoDay | null;
  appLastDay: IsoDay | null;
  removedInApp: boolean;
  startOverride: IsoDay | null;
  endOverride: IsoDay | null;
  startDate: IsoDay | null;
  endDate: IsoDay | null;
  spanDays: number | null;
  note: string | null;
  isCurrent: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

export interface AssessmentCheck {
  id: number;
  programId: number | null;
  kind: AssessmentKind;
  status: 'scheduled' | 'done' | 'waived';
  checkDate: IsoDay;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface HubNote {
  id: number;
  date: IsoDay;
  body: string;
  goals: string | null;
  link: string | null;
  authorName: string | null;
  createdAt: string;
}

export interface HubEvent {
  id: number;
  at: string;
  actorName: string | null;
  action: string;
  detail: Record<string, unknown> | null;
}

// ---- 8ctane app snapshot, normalized ----

export interface AppProgram {
  id: number;
  userId: string;
  name: string | null;
  type: ProgramType | null;
  start: IsoDay | null;
  end: IsoDay | null;
  archived: boolean;
  firstDay: IsoDay | null;
  lastDay: IsoDay | null;
  coaches: string[];
}

export interface AppUser {
  id: string;
  email: string | null;
  name: string;
  programs: AppProgram[];
}

export interface SetCompletion {
  plannedSets: number;
  unknownSets: number; // prescribed sets without a per-set flag (lifts nobody touched)
  completedSets: number;
}

export interface CalendarActivity {
  kind: string;
  name: string | null;
  completion: SetCompletion | null; // null = untracked (throwing)
}

export interface CalendarDay {
  date: IsoDay;
  activities: CalendarActivity[];
}

/** The signed-in coach. */
export interface Actor {
  clerkUserId: string;
  name: string;
}
