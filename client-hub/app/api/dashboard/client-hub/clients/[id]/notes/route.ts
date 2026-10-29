import { NextResponse } from 'next/server';
import { hubRoute, requireStaff, type IdParams } from '@/lib/client-hub/http';
import { CreateNoteSchema } from '@/lib/client-hub/schemas';
import { addNote } from '@/lib/client-hub/service';

export const POST = hubRoute(async (req: Request, { params }: IdParams) => {
  const me = await requireStaff();
  const { id } = await params;
  const input = CreateNoteSchema.parse(await req.json());
  return NextResponse.json(await addNote(id, me, input), { status: 201 });
});
