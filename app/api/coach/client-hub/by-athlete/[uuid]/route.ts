import { NextResponse } from 'next/server';
import { hubRoute } from '@/lib/client-hub/http';
import { clientForAthlete } from '@/lib/client-hub/service';

export const dynamic = 'force-dynamic';

/** GET /api/coach/client-hub/by-athlete/:uuid → { client: { id, status, isActive } | null } */
export const GET = hubRoute<{ params: Promise<{ uuid: string }> }>(async (_req, { params }) => {
  const { uuid } = await params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(uuid)) return NextResponse.json({ client: null });
  return NextResponse.json({ client: await clientForAthlete(uuid) });
});
