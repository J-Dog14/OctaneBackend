import { NextResponse } from 'next/server';
import { hubRoute, requireStaff } from '@/lib/client-hub/http';
import { httpOctaneSource } from '@/lib/client-hub/octane/source';
import { seedFromOctane } from '@/lib/client-hub/service';

/** Adds every 8ctane athlete on an active REMOTE/HYBRID program who isn't in the hub yet. Idempotent. */
export const POST = hubRoute(async () => {
  await requireStaff();
  return NextResponse.json(await seedFromOctane(httpOctaneSource));
});
