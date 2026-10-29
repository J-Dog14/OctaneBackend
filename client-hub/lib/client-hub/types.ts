import type { IsoDay } from './dates';
import type { UpdateField } from './constants';

export type ClientStatus = 'ACTIVE' | 'PAUSED' | 'ENDED';
export type ProgramType = 'REMOTE' | 'HYBRID' | 'IN_HOUSE';
export type ContractStatus = 'SIGNED' | 'SENT' | 'NOT_SENT';
export type LinkSource = 'AUTO' | 'MANUAL' | 'DISMISSED';
export type DateSource = 'OCTANE' | 'MANUAL';

/** A hub client with dates as 'YYYY-MM-DD'. Field names match the Prisma model. */
export interface ClientFacts {
  id: string;
  name: string;
  status: ClientStatus;
  phase: string | null;
  scheduleNote: string | null;
  programType: ProgramType | null;
  coachName: string | null;
  ownerClerkUserId: string | null;
  age: number | null;
  throws: string | null;
  position: string | null;
  team: string | null;
  octaneAthleteUuid: string | null;
  octaneName: string | null;
  linkSource: LinkSource | null;
  contractDuration: string | null;
  contractStart: IsoDay | null;
  contractEnd: IsoDay | null;
  contractStatus: ContractStatus;
  onbAssessment: boolean;
  onb3d: boolean;
  onbReview: boolean;
  lastAssessment: IsoDay | null;
  lastContacted: IsoDay | null;
  builtUntil: IsoDay | null;
  updPlyos: IsoDay | null;
  updPlyosSource: DateSource | null;
  updLifts: IsoDay | null;
  updLiftsSource: DateSource | null;
  updDelivery: IsoDay | null;
  updDeliverySource: DateSource | null;
  needsReview: boolean;
  weekDone: number | null;
  weekTrackable: number | null;
  lastTick: IsoDay | null;
  syncedAt: string | null; // ISO timestamp
}

export type UpdateSourceField = `${UpdateField}Source`;

// ---- 8ctane, normalized ----

export interface HubCoachRef {
  userUuid: string | null;
  name: string;
}

export interface HubProgram {
  uuid: string;
  name: string;
  type: string | null; // 'REMOTE' | 'IN_HOUSE' | … as 8ctane reports it
  endDate: IsoDay | null;
  coaches: HubCoachRef[];
}

export interface HubAthlete {
  uuid: string;
  name: string;
  programs: HubProgram[];
}

export interface CoverageAlert {
  programUuid: string;
  lastScheduledDate: IsoDay | null;
  daysUntilLastScheduledDay: number | null;
}

export interface SetCompletion {
  plannedSets: number;
  unknownSets: number; // prescribed sets without a per-set flag (most lifts)
  completedSets: number;
}

export interface CalendarActivity {
  kind: string;
  name: string | null;
  completion: SetCompletion | null; // null = untracked (e.g. throwing)
}

export interface CalendarDay {
  date: IsoDay;
  activities: CalendarActivity[];
}

/** The signed-in staff member, as the hub needs them. */
export interface StaffUser {
  clerkUserId: string;
  name: string;
  octaneUserUuid: string | null; // from HubCoach, when they've linked themselves
}
