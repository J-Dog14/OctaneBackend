import { NextResponse } from 'next/server';
import { hubRoute, jsonBody, type IdParams } from '@/lib/client-hub/http';
import { refreshStatus, updateClientFields } from '@/lib/client-hub/repository';
import { IdSchema, UpdateClientSchema } from '@/lib/client-hub/schemas';
import { getClientDetail } from '@/lib/client-hub/service';

export const dynamic = 'force-dynamic';

/** GET /api/coach/client-hub/clients/:id — the client page (re-reads this client's calendar). */
export const GET = hubRoute<IdParams>(async (_req, { params }, me) => {
  const id = IdSchema.parse((await params).id);
  return NextResponse.json(await getClientDetail(id, me));
});

/** PATCH /api/coach/client-hub/clients/:id — any subset of the editable fields. */
export const PATCH = hubRoute<IdParams>(async (req, { params }, me) => {
  const id = IdSchema.parse((await params).id);
  const { isMine, ...fields } = UpdateClientSchema.parse(await jsonBody(req));
  const patch: Record<string, unknown> = { ...fields };
  if (isMine !== undefined) {
    patch.ownerClerkUserId = isMine ? me.clerkUserId : null;
    patch.ownerName = isMine ? me.name : null;
  }
  const changed = await updateClientFields(id, patch, me);
  if (changed.includes('statusOverride')) {
    // Override cleared → back to the automatic status straight away.
    await refreshStatus(id);
  }
  return NextResponse.json({ changed });
});
