// Request validation for the Client Hub API. Parse at the route; services trust these types.
import { z } from 'zod';
import { FOCUSES } from './flags';

const IsoDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const nullableDay = IsoDaySchema.nullable();
const shortText = (max: number) => z.string().trim().max(max).nullable();

export const ProgramTypeSchema = z.enum(['REMOTE', 'HYBRID', 'IN_HOUSE']);

export const ListQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  status: z.enum(['ACTIVE', 'PAUSED', 'ENDED', 'ALL']).default('ACTIVE'),
  focus: z.enum(FOCUSES).nullable().default(null),
  q: z.string().max(100).default(''),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;

export const CreateClientSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    programType: ProgramTypeSchema,
  })
  .strict();
export type CreateClientInput = z.infer<typeof CreateClientSchema>;

export const UpdateClientSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    status: z.enum(['ACTIVE', 'PAUSED', 'ENDED']),
    phase: shortText(60),
    scheduleNote: shortText(200),
    programType: ProgramTypeSchema.nullable(),
    coachName: shortText(120),
    isMine: z.boolean(), // sets / clears ownerClerkUserId for the signed-in coach
    age: z.number().int().min(5).max(80).nullable(),
    throws: z.enum(['R', 'L']).nullable(),
    position: shortText(60),
    team: shortText(120),
    contractDuration: shortText(60),
    contractStart: nullableDay,
    contractEnd: nullableDay,
    contractStatus: z.enum(['SIGNED', 'SENT', 'NOT_SENT']),
    onbAssessment: z.boolean(),
    onb3d: z.boolean(),
    onbReview: z.boolean(),
    lastAssessment: nullableDay,
    lastContacted: nullableDay,
    builtUntil: nullableDay,
    updPlyos: nullableDay,
    updLifts: nullableDay,
    updDelivery: nullableDay,
    needsReview: z.boolean(),
  })
  .partial()
  .strict();
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>;

export const CreateNoteSchema = z
  .object({
    date: IsoDaySchema,
    body: z.string().trim().min(1).max(5000),
    goals: z.string().trim().max(500).optional(),
    link: z
      .string()
      .trim()
      .url()
      .refine((u) => /^https?:\/\//.test(u), 'Use an http(s) link')
      .optional(),
  })
  .strict();
export type CreateNoteInput = z.infer<typeof CreateNoteSchema>;

export const LinkAthleteSchema = z.object({ octaneAthleteUuid: z.string().uuid() }).strict();

export const SetMyCoachSchema = z
  .object({
    octaneUserUuid: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
  })
  .strict();
export type SetMyCoachInput = z.infer<typeof SetMyCoachSchema>;
