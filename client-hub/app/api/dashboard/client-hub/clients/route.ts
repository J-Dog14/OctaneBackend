import { NextResponse } from 'next/server';
import { hubRoute, requireStaff } from '@/lib/client-hub/http';
import { httpOctaneSource } from '@/lib/client-hub/octane/source';
import { CreateClientSchema, ListQuerySchema } from '@/lib/client-hub/schemas';
import { createClient, listClients } from '@/lib/client-hub/service';

/** GET ?scope=mine|all&status=ACTIVE|PAUSED|ENDED|ALL&focus=program|quiet|updates|onboarding|contract|review&q= */
export const GET = hubRoute(async (req: Request) => {
  const me = await requireStaff();
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const query = ListQuerySchema.parse(params);
  return NextResponse.json(await listClients(me, query, httpOctaneSource));
});

export const POST = hubRoute(async (req: Request) => {
  const me = await requireStaff();
  const input = CreateClientSchema.parse(await req.json());
  return NextResponse.json(await createClient(me, input, httpOctaneSource), { status: 201 });
});
