// Request validation for the Client Hub API. Parse at the route; the service trusts these types.
import { z } from 'zod';
import { ASSESSMENT_KIND_IDS, PROGRAM_TYPES, STATUSES } from './constants';
import { FOCUSES } from './flags';
import { CHECKLIST_KINDS } from './assessmentRules';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (max: number) => z.string().trim().max(max).transform((s) => s || null).nullable();

export const IdSchema = z.string().uuid();
export const IntIdSchema = z.coerce.number().int().positive();

export const ListQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).default('all'),
  status: z.enum([...STATUSES, 'all']).default('active'),
  types: z
    .string()
    .default('')
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(PROGRAM_TYPES))),
  focus: z.enum(FOCUSES).nullable().default(null),
  q: z.string().max(100).default(''),
});

export const UpdateClientSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    /** null = back to automatic (from the program dates). */
    statusOverride: z.enum(STATUSES).nullable(),
    phase: text(60),
    scheduleNote: text(200),
    coachName: text(120),
    isMine: z.boolean(),
    throws: z.enum(['R', 'L']).nullable(),
    position: text(60),
    team: text(120),
    contractDuration: text(60),
    contractStart: day.nullable(),
    contractEnd: day.nullable(),
    contractStatus: z.enum(['SIGNED', 'SENT', 'NOT_SENT']),
    onbAssessment: z.boolean(),
    onb3d: z.boolean(),
    onbReview: z.boolean(),
    lastContacted: day.nullable(),
    nextAssessmentDue: day.nullable(),
    needsReview: z.boolean(),
    updPlyos: day.nullable(),
    updLifts: day.nullable(),
    updDelivery: day.nullable(),
  })
  .partial()
  .strict();

export const PeriodPatchSchema = z
  .object({
    startOverride: day.nullable(),
    endOverride: day.nullable(),
    name: text(120),
    programType: z.enum(PROGRAM_TYPES).nullable(),
    note: text(500),
  })
  .partial()
  .strict();

export const NewPeriodSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    programType: z.enum(PROGRAM_TYPES).nullable().default(null),
    start: day,
    end: day.nullable().default(null),
    note: text(500).optional(),
  })
  .strict();

export const NewNoteSchema = z
  .object({
    date: day,
    body: z.string().trim().min(1).max(5000),
    goals: z.string().trim().max(500).optional(),
    link: z.string().trim().url().refine((u) => /^https?:\/\//.test(u), 'Use an http(s) link').optional(),
  })
  .strict();

export const NewCheckSchema = z
  .object({
    kind: z.enum(ASSESSMENT_KIND_IDS as [string, ...string[]]),
    status: z.enum(['scheduled', 'done', 'waived']),
    date: day,
    programId: z.number().int().positive().nullable().optional(),
    note: text(300).optional(),
  })
  .strict();

export const LinkSchema = z.union([
  z.object({ athleteUuid: z.string().min(1).max(64) }).strict(),
  z.object({ create: z.literal(true) }).strict(),
]);

export const SyncSchema = z.object({ force: z.boolean().default(false), dryRun: z.boolean().default(false) }).strict();

export const ChecklistSchema = z
  .object({
    kind: z.enum(CHECKLIST_KINDS as [string, ...string[]]),
    done: z.boolean(),
  })
  .strict();
