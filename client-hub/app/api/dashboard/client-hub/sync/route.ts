import { NextResponse } from 'next/server';
import { hubRoute, requireStaff } from '@/lib/client-hub/http';
import { httpOctaneSource } from '@/lib/client-hub/octane/source';
import { syncClients } from '@/lib/client-hub/service';

/** Auto-link + refresh stale clients. The list page calls this when `staleCount > 0`. */
export const POST = hubRoute(async () => {
  await requireStaff();
  return NextResponse.json(await syncClients(httpOctaneSource));
});
