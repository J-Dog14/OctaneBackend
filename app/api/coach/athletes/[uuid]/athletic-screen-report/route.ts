import { cachedCoachData } from "@/lib/coach/cache";
import { NextRequest } from "next/server";
import { badRequest, internalError, notFound, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { buildAthleticScreenReport } from "@/lib/coach/athleticScreen/report";

export const dynamic = "force-dynamic";

/** GET /api/coach/athletes/:uuid/athletic-screen-report?date=YYYY-MM-DD — DJ/CMJ/PPU/SLV report pages (latest screen by default). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  const date = new URL(request.url).searchParams.get("date");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest("date must be YYYY-MM-DD");
  try {
    const report = await cachedCoachData(request, ["athletic-screen-report", uuid, date || null], () => buildAthleticScreenReport(uuid, date));
    return report ? success(report) : notFound("No athletic screens for this athlete");
  } catch (error) {
    console.error("Error in GET /api/coach/athletes/[uuid]/athletic-screen-report:", error);
    return internalError("Failed to build the athletic screen report");
  }
}
