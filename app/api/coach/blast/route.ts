import { NextResponse } from "next/server";
import { blastRoute, noStore } from "@/lib/blast/http";
import { getState } from "@/lib/blast/service";

export const dynamic = "force-dynamic";

/** GET /api/coach/blast — sensors with who's on them now, today's assignment log, swings needing review. */
export const GET = blastRoute(async () => NextResponse.json(await getState(), { headers: noStore }));
