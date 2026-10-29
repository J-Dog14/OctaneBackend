import { NextResponse } from 'next/server';
import { todayIso } from '@/lib/client-hub/dates';
import { hubRoute, jsonBody, type IdParams } from '@/lib/client-hub/http';
import { addNote } from '@/lib/client-hub/repository';
import { IdSchema, NewNoteSchema } from '@/lib/client-hub/schemas';

/** POST /api/coach/client-hub/clients/:id/notes — coach log entry (dated today → also sets "last contacted"). */
export const POST = hubRoute<IdParams>(async (req, { params }, me) => {
  const id = IdSchema.parse((await params).id);
  const input = NewNoteSchema.parse(await jsonBody(req));
  return NextResponse.json({ id: await addNote(id, input, me, todayIso()) }, { status: 201 });
});
