import { cachedCoachData } from "@/lib/coach/cache";
import { NextRequest } from "next/server";
import { internalError, notFound, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { getCoachAthleteSummary } from "@/lib/coach/summary";

export const dynamic = "force-dynamic";

/** GET /api/coach/athletes/:uuid/summary — header, data sources, which tabs have data. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  try {
    const summary = await cachedCoachData(request, ["summary", uuid], () => getCoachAthleteSummary(uuid));
    return summary ? success(summary) : notFound("Athlete not found");
  } catch (error) {
    console.error("Error in GET /api/coach/athletes/[uuid]/summary:", error);
    return internalError("Failed to load athlete");
  }
}
