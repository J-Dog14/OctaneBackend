import { NextResponse } from 'next/server';
import { hubRoute, type SubParams } from '@/lib/client-hub/http';
import { deleteNote, logEvent } from '@/lib/client-hub/repository';
import { IdSchema, IntIdSchema } from '@/lib/client-hub/schemas';

export const DELETE = hubRoute<SubParams>(async (_req, { params }, me) => {
  const p = await params;
  const id = IdSchema.parse(p.id);
  const noteId = IntIdSchema.parse(p.subId);
  await deleteNote(id, noteId);
  await logEvent(id, me, 'note.delete', { noteId });
  return NextResponse.json({ ok: true });
});
