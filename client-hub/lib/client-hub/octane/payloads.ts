// Zod schemas for the three 8ctane reads the hub needs. Shapes match what the 8ctane Database
// connector returns today (octane_athletes, octane_alerts kind=programming, octane_training_calendar).
// Validate at the boundary, then hand the rest of the hub plain normalized types.
import { z } from 'zod';
import type { CalendarDay, CoverageAlert, HubAthlete } from '../types';

const CoachSchema = z.object({
  userUuid: z.string().nullish(),
  name: z.string(),
});

const ProgramSchema = z.object({
  programUuid: z.string(),
  name: z.string().nullish(),
  endDate: z.string().nullish(),
  programType: z.string().nullish(),
  coaches: z.array(CoachSchema).default([]),
});

const AthleteSchema = z.object({
  athleteUuid: z.string(),
  name: z.string(),
  activePrograms: z.array(ProgramSchema).default([]),
});

export const AthletesPageSchema = z.object({
  athletes: z.array(AthleteSchema).default([]),
  nextCursor: z.string().nullish(),
});

const ProgrammingAlertSchema = z.object({
  programUuid: z.string(),
  lastScheduledDate: z.string().nullish(),
  daysUntilLastScheduledDay: z.number().nullish(),
});

export const AlertsPageSchema = z.object({
  alerts: z.array(ProgrammingAlertSchema).default([]),
  nextCursor: z.string().nullish(),
});

const CompletionSchema = z.object({
  plannedSets: z.number(),
  unknownSets: z.number(),
  completedSets: z.number(),
});

const ActivitySchema = z.object({
  kind: z.string(),
  name: z.string().nullish(),
  completion: CompletionSchema.nullish(),
});

const DaySchema = z.object({
  date: z.string(),
  activities: z.array(ActivitySchema).default([]),
});

export const CalendarPageSchema = z.object({
  days: z.array(DaySchema).default([]),
  nextCursor: z.string().nullish(),
});

type AthletesPage = z.infer<typeof AthletesPageSchema>;
type AlertsPage = z.infer<typeof AlertsPageSchema>;
type CalendarPage = z.infer<typeof CalendarPageSchema>;

export function toHubAthletes(page: AthletesPage): HubAthlete[] {
  return page.athletes.map((a) => ({
    uuid: a.athleteUuid,
    name: a.name,
    programs: a.activePrograms.map((p) => ({
      uuid: p.programUuid,
      name: (p.name ?? '').trim(),
      type: p.programType ?? null,
      endDate: p.endDate ? p.endDate.slice(0, 10) : null,
      coaches: p.coaches.map((c) => ({ userUuid: c.userUuid ?? null, name: c.name })),
    })),
  }));
}

export function toCoverageAlerts(page: AlertsPage): CoverageAlert[] {
  return page.alerts.map((a) => ({
    programUuid: a.programUuid,
    lastScheduledDate: a.lastScheduledDate ? a.lastScheduledDate.slice(0, 10) : null,
    daysUntilLastScheduledDay: a.daysUntilLastScheduledDay ?? null,
  }));
}

export function toCalendarDays(page: CalendarPage): CalendarDay[] {
  return page.days.map((d) => ({
    date: d.date.slice(0, 10),
    activities: d.activities.map((a) => ({ kind: a.kind, name: a.name ?? null, completion: a.completion ?? null })),
  }));
}
