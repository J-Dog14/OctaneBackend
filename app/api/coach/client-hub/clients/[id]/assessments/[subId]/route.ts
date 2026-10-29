import { NextResponse } from 'next/server';
import { hubRoute, type SubParams } from '@/lib/client-hub/http';
import { deleteCheck } from '@/lib/client-hub/repository';
import { IdSchema, IntIdSchema } from '@/lib/client-hub/schemas';

export const DELETE = hubRoute<SubParams>(async (_req, { params }, me) => {
  const p = await params;
  await deleteCheck(IdSchema.parse(p.id), IntIdSchema.parse(p.subId), me);
  return NextResponse.json({ ok: true });
});
