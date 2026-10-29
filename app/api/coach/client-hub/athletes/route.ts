import { NextResponse } from 'next/server';
import { hubRoute } from '@/lib/client-hub/http';
import { searchAthletes } from '@/lib/client-hub/service';

export const dynamic = 'force-dynamic';

/** GET /api/coach/client-hub/athletes?q= — warehouse athletes for the link picker. */
export const GET = hubRoute(async (req) => {
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 80);
  return NextResponse.json({ athletes: await searchAthletes(q) });
});
