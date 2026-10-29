import { NextResponse } from 'next/server';
import { hubRoute, jsonBody } from '@/lib/client-hub/http';
import { syncHub } from '@/lib/client-hub/appSync';
import { SyncSchema } from '@/lib/client-hub/schemas';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/coach/client-hub/sync { force?, dryRun? } — app snapshot → hub tables. Skips when the hub
 * is fresh (synced < 6 h ago and nothing newer in the snapshot) unless forced. dryRun reports and rolls back.
 */
export const POST = hubRoute(async (req) => {
  const { force, dryRun } = SyncSchema.parse(await jsonBody(req));
  return NextResponse.json(await syncHub({ force, dryRun }));
});
