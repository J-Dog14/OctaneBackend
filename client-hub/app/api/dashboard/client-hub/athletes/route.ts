import { NextResponse } from 'next/server';
import { hubRoute, requireStaff } from '@/lib/client-hub/http';
import { httpOctaneSource } from '@/lib/client-hub/octane/source';
import { listAthletesForPicker } from '@/lib/client-hub/service';

/** Athlete picker for linking. ?forName= adds ranked suggestions for that client name. */
export const GET = hubRoute(async (req: Request) => {
  const me = await requireStaff();
  const forName = new URL(req.url).searchParams.get('forName')?.slice(0, 120) || undefined;
  return NextResponse.json(await listAthletesForPicker(me, httpOctaneSource, forName));
});
