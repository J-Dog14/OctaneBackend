import { NextResponse } from 'next/server';
import { hubRoute } from '@/lib/client-hub/http';
import { ListQuerySchema } from '@/lib/client-hub/schemas';
import { listHub } from '@/lib/client-hub/service';

export const dynamic = 'force-dynamic';

/** GET /api/coach/client-hub/clients?status=active|paused|expired|all&scope=mine|all&types=REMOTE,HYBRID&focus=&q= */
export const GET = hubRoute(async (req, _ctx, me) => {
  const query = ListQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return NextResponse.json(await listHub(me, query));
});
