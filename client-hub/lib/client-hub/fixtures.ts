// Test fixtures shared by the Client Hub tests.
import type { CalendarDay, ClientFacts, HubAthlete } from './types';

export function client(overrides: Partial<ClientFacts> = {}): ClientFacts {
  return {
    id: 'c1', name: 'Thomas Greer', status: 'ACTIVE', phase: null, scheduleNote: null, programType: null,
    coachName: null, ownerClerkUserId: 'user_me', age: null, throws: null, position: null, team: null,
    octaneAthleteUuid: null, octaneName: null, linkSource: null, contractDuration: null, contractStart: null,
    contractEnd: null, contractStatus: 'NOT_SENT', onbAssessment: false, onb3d: false, onbReview: false,
    lastAssessment: null, lastContacted: null, builtUntil: null, updPlyos: null, updPlyosSource: null,
    updLifts: null, updLiftsSource: null, updDelivery: null, updDeliverySource: null, needsReview: false,
    weekDone: null, weekTrackable: null, lastTick: null, syncedAt: null,
    ...overrides,
  };
}

export const ME = 'b0418652-f6c6-49c6-86d4-a0a9dfd86253';
export const OTHER = '18bbdbca-891e-4fc2-b399-6d9f7880b781';

export function athlete(uuid: string, name: string, programs: Partial<HubAthlete['programs'][number]>[] = []): HubAthlete {
  return {
    uuid, name,
    programs: programs.map((p, i) => ({ uuid: `${uuid}-p${i}`, name: 'Program', type: 'REMOTE', endDate: null, coaches: [], ...p })),
  };
}

export function day(date: string, activities: CalendarDay['activities']): CalendarDay {
  return { date, activities };
}

export const sets = (completedSets: number, plannedSets: number, unknownSets = 0) => ({ completedSets, plannedSets, unknownSets });
