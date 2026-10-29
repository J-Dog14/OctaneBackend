import { NextResponse } from 'next/server';
import { hubRoute, jsonBody, type IdParams } from '@/lib/client-hub/http';
import { todayIso } from '@/lib/client-hub/dates';
import { addCheck, setChecklist } from '@/lib/client-hub/repository';
import { ChecklistSchema, IdSchema, NewCheckSchema } from '@/lib/client-hub/schemas';

/** POST — schedule an assessment, mark one done (e.g. done elsewhere), or waive it. */
export const POST = hubRoute<IdParams>(async (req, { params }, me) => {
  const id = IdSchema.parse((await params).id);
  const input = NewCheckSchema.parse(await jsonBody(req));
  return NextResponse.json({ id: await addCheck(id, input, me) }, { status: 201 });
});

/** PUT { kind, done } — check / uncheck Mobility, Proteus, 3D or Athletic screen for the current program. */
export const PUT = hubRoute<IdParams>(async (req, { params }, me) => {
  const id = IdSchema.parse((await params).id);
  const { kind, done } = ChecklistSchema.parse(await jsonBody(req));
  await setChecklist(id, kind, done, me, todayIso());
  return NextResponse.json({ ok: true });
});
