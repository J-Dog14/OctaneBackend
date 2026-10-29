import { NextResponse } from 'next/server';
import { hubRoute, requireStaff } from '@/lib/client-hub/http';
import { SetMyCoachSchema } from '@/lib/client-hub/schemas';
import { setMyCoach } from '@/lib/client-hub/service';

/** Who am I in 8ctane? octaneUserUuid null = not linked yet (pick from GET /athletes → coaches). */
export const GET = hubRoute(async () => NextResponse.json(await requireStaff()));

export const PUT = hubRoute(async (req: Request) => {
  const me = await requireStaff();
  const input = SetMyCoachSchema.parse(await req.json());
  return NextResponse.json(await setMyCoach(me, input));
});
