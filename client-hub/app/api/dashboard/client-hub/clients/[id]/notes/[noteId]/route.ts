import { NextResponse } from 'next/server';
import { hubRoute, requireStaff, type NoteParams } from '@/lib/client-hub/http';
import { deleteNote } from '@/lib/client-hub/service';

export const DELETE = hubRoute(async (_req: Request, { params }: NoteParams) => {
  await requireStaff();
  const { id, noteId } = await params;
  await deleteNote(id, noteId);
  return new NextResponse(null, { status: 204 });
});
