import { NextResponse } from 'next/server';
import { hubRoute, requireStaff, type IdParams } from '@/lib/client-hub/http';
import { httpOctaneSource } from '@/lib/client-hub/octane/source';
import { LinkAthleteSchema } from '@/lib/client-hub/schemas';
import { linkClient, unlinkClient } from '@/lib/client-hub/service';

export const POST = hubRoute(async (req: Request, { params }: IdParams) => {
  await requireStaff();
  const { id } = await params;
  const { octaneAthleteUuid } = LinkAthleteSchema.parse(await req.json());
  return NextResponse.json(await linkClient(id, octaneAthleteUuid, httpOctaneSource));
});

export const DELETE = hubRoute(async (_req: Request, { params }: IdParams) => {
  await requireStaff();
  const { id } = await params;
  return NextResponse.json(await unlinkClient(id));
});
