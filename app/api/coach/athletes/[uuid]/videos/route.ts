import { NextResponse } from "next/server";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { noStore, videoRoute } from "@/lib/videos/http";
import { listForAthlete } from "@/lib/videos/service";

type Params = { params: Promise<{ uuid: string }> };

/** GET /api/coach/athletes/:uuid/videos: one athlete's clips (their Videos tab). */
export const GET = videoRoute<Params>(async (_req, { params }) => {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  return NextResponse.json(await listForAthlete(uuid), { headers: noStore });
});
