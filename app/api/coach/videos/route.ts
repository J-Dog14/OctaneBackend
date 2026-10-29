import { NextResponse } from "next/server";
import { noStore, videoRoute } from "@/lib/videos/http";
import { listLibrary } from "@/lib/videos/service";

export const dynamic = "force-dynamic";

/** GET /api/coach/videos: every ready clip across athletes (the Video Hub library). */
export const GET = videoRoute(async () => NextResponse.json(await listLibrary(), { headers: noStore }));
