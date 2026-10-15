import { cachedCoachData } from "@/lib/coach/cache";
import { NextRequest } from "next/server";
import { badRequest, internalError, notFound, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { buildBiomechReport } from "@/lib/coach/biomech/report";

export const dynamic = "force-dynamic";

/** GET /api/coach/athletes/:uuid/biomech-report?date=YYYY-MM-DD — 8-cylinder pitching report (latest capture by default). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  const date = new URL(request.url).searchParams.get("date");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest("date must be YYYY-MM-DD");
  try {
    const report = await cachedCoachData(request, ["biomech-report", uuid, date || null], () => buildBiomechReport(uuid, date));
    return report ? success(report) : notFound("No pitching captures for this athlete");
  } catch (error) {
    console.error("Error in GET /api/coach/athletes/[uuid]/biomech-report:", error);
    return internalError("Failed to build the biomechanics report");
  }
}
