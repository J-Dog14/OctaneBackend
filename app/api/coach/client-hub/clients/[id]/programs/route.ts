import { NextResponse } from 'next/server';
import { hubRoute, jsonBody, type IdParams } from '@/lib/client-hub/http';
import { addPeriod } from '@/lib/client-hub/repository';
import { IdSchema, NewPeriodSchema } from '@/lib/client-hub/schemas';

/** POST /api/coach/client-hub/clients/:id/programs — a program period the app doesn't have (e.g. before the app). */
export const POST = hubRoute<IdParams>(async (req, { params }, me) => {
  const id = IdSchema.parse((await params).id);
  const input = NewPeriodSchema.parse(await jsonBody(req));
  return NextResponse.json(await addPeriod(id, { ...input, note: input.note ?? null }, me), { status: 201 });
});
