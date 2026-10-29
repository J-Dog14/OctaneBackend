// Prisma <-> ClientFacts. The only file that knows dates are Date objects in the database.
import type { HubClient, Prisma } from '@prisma/client';
import { fromIsoDay, toIsoDay } from './dates';
import type { ClientFacts } from './types';

export function toFacts(row: HubClient): ClientFacts {
  return {
    ...row,
    contractStart: toIsoDay(row.contractStart),
    contractEnd: toIsoDay(row.contractEnd),
    lastAssessment: toIsoDay(row.lastAssessment),
    lastContacted: toIsoDay(row.lastContacted),
    builtUntil: toIsoDay(row.builtUntil),
    updPlyos: toIsoDay(row.updPlyos),
    updLifts: toIsoDay(row.updLifts),
    updDelivery: toIsoDay(row.updDelivery),
    lastTick: toIsoDay(row.lastTick),
    syncedAt: row.syncedAt ? row.syncedAt.toISOString() : null,
  };
}

/** undefined stays undefined (Prisma: "leave unchanged"); null clears; a day becomes UTC midnight. */
const day = (v: string | null | undefined) => (v === undefined ? undefined : fromIsoDay(v));

export type ClientPatch = Partial<Omit<ClientFacts, 'id'>>;

export function toUpdateData(patch: ClientPatch): Prisma.HubClientUncheckedUpdateInput {
  const {
    contractStart,
    contractEnd,
    lastAssessment,
    lastContacted,
    builtUntil,
    updPlyos,
    updLifts,
    updDelivery,
    lastTick,
    syncedAt,
    ...plain
  } = patch;
  return {
    ...plain,
    contractStart: day(contractStart),
    contractEnd: day(contractEnd),
    lastAssessment: day(lastAssessment),
    lastContacted: day(lastContacted),
    builtUntil: day(builtUntil),
    updPlyos: day(updPlyos),
    updLifts: day(updLifts),
    updDelivery: day(updDelivery),
    lastTick: day(lastTick),
    syncedAt: syncedAt === undefined ? undefined : syncedAt ? new Date(syncedAt) : null,
  };
}
