import { NextResponse } from 'next/server';
import { hubRoute, requireStaff, type IdParams } from '@/lib/client-hub/http';
import { httpOctaneSource } from '@/lib/client-hub/octane/source';
import { UpdateClientSchema } from '@/lib/client-hub/schemas';
import { deleteClient, getClientDetail, updateClient } from '@/lib/client-hub/service';

/** Profile: client, coach log, and the live "In the app" card (also refreshes the client's sync cache). */
export const GET = hubRoute(async (_req: Request, { params }: IdParams) => {
  const me = await requireStaff();
  const { id } = await params;
  return NextResponse.json(await getClientDetail(id, me, httpOctaneSource));
});

/** Partial update — the profile saves one field at a time on change. */
export const PATCH = hubRoute(async (req: Request, { params }: IdParams) => {
  const me = await requireStaff();
  const { id } = await params;
  const input = UpdateClientSchema.parse(await req.json());
  return NextResponse.json(await updateClient(id, me, input));
});

export const DELETE = hubRoute(async (_req: Request, { params }: IdParams) => {
  await requireStaff();
  const { id } = await params;
  await deleteClient(id);
  return new NextResponse(null, { status: 204 });
});
