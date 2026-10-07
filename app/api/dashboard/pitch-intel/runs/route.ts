import { NextRequest } from "next/server";
import { internalError, success } from "@/lib/responses";
import { apiErrorMessage } from "@/lib/pitch-intel/errors";
import { requireAuth } from "@/lib/auth/requireAuth";
import { recentRuns } from "@/lib/pitch-intel/db";

export const dynamic = "force-dynamic";

/** GET /api/dashboard/pitch-intel/runs?limit=25&linkId=3 — recent pulls, newest first. */
export async function GET(request: NextRequest) {
  await requireAuth();
  try {
    const sp = new URL(request.url).searchParams;
    const limit = Math.min(200, Math.max(1, Number(sp.get("limit") ?? 25) || 25));
    const linkId = sp.get("linkId") ? Number(sp.get("linkId")) : undefined;
    return success({ runs: await recentRuns(limit, Number.isInteger(linkId) ? linkId : undefined) });
  } catch (error) {
    console.error("Error in GET /api/dashboard/pitch-intel/runs:", error);
    return internalError(apiErrorMessage(error, "Failed to load pull runs"));
  }
}
