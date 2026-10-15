import { cachedCoachData } from "@/lib/coach/cache";
import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { buildAthleteTrackingReport } from "@/lib/athlete-tracking/report";
import type { DomainId } from "@/lib/athlete-tracking/types";

export const dynamic = "force-dynamic";

const DOMAIN_IDS: DomainId[] = ["pitching", "hitting", "mobility", "athleticScreen", "armAction", "proteus"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/coach/athletes/:uuid/tracking — percentile report per domain.
 * Optional per-domain session: ?pitchingDate=YYYY-MM-DD&mobilityDate=…
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const domainsParam = searchParams.get("domains");
  const requested = domainsParam?.split(",").map((id) => id.trim());
  if (requested?.some((id) => !DOMAIN_IDS.includes(id as DomainId))) return badRequest("Unknown tracking domain");
  const domains = requested ? DOMAIN_IDS.filter((id) => requested.includes(id)) : undefined;
  const sessionDates: Partial<Record<DomainId, string>> = {};
  for (const id of DOMAIN_IDS) {
    const v = searchParams.get(`${id}Date`);
    if (!v) continue;
    if (!DATE_RE.test(v)) return badRequest(`${id}Date must be YYYY-MM-DD`);
    sessionDates[id] = v;
  }
  try {
    const report = await cachedCoachData(request, ["tracking", uuid, sessionDates, domains], () => buildAthleteTrackingReport(uuid, Object.keys(sessionDates).length ? sessionDates : undefined, domains));
    return success(report);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Error in GET /api/coach/athletes/[uuid]/tracking:", error);
    return internalError("Failed to build tracking report");
  }
}
