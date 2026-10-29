import { NextResponse } from 'next/server';
import { hubRoute, jsonBody, type IdParams } from '@/lib/client-hub/http';
import { IdSchema, LinkSchema } from '@/lib/client-hub/schemas';
import { createAthleteForClient, linkClientToAthlete } from '@/lib/client-hub/service';

/** POST { athleteUuid } links the client to that warehouse athlete; { create: true } makes a new d_athletes row. */
export const POST = hubRoute<IdParams>(async (req, { params }, me) => {
  const id = IdSchema.parse((await params).id);
  const body = LinkSchema.parse(await jsonBody(req));
  if ('create' in body) return NextResponse.json({ athleteUuid: await createAthleteForClient(id, me) });
  await linkClientToAthlete(id, body.athleteUuid, me);
  return NextResponse.json({ athleteUuid: body.athleteUuid });
});
