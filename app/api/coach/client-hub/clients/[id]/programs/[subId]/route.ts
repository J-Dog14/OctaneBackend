import { NextResponse } from 'next/server';
import { hubRoute, jsonBody, type SubParams } from '@/lib/client-hub/http';
import { deletePeriod, updatePeriod } from '@/lib/client-hub/repository';
import { IdSchema, IntIdSchema, PeriodPatchSchema } from '@/lib/client-hub/schemas';

/** PATCH — change start/end (stored as coach overrides; null = back to the app's date), note; name/type for coach periods. */
export const PATCH = hubRoute<SubParams>(async (req, { params }, me) => {
  const p = await params;
  const patch = PeriodPatchSchema.parse(await jsonBody(req));
  return NextResponse.json(await updatePeriod(IdSchema.parse(p.id), IntIdSchema.parse(p.subId), patch, me));
});

/** DELETE — coach-added periods only. */
export const DELETE = hubRoute<SubParams>(async (_req, { params }, me) => {
  const p = await params;
  await deletePeriod(IdSchema.parse(p.id), IntIdSchema.parse(p.subId), me);
  return NextResponse.json({ ok: true });
});
