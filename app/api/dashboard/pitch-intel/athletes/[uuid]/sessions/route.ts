import { NextRequest } from "next/server";
import { internalError, notFound, success } from "@/lib/responses";
import { requireAuth } from "@/lib/auth/requireAuth";
import { getAthleteSessions } from "@/lib/pitch-intel/sessions";
import { apiErrorMessage } from "@/lib/pitch-intel/errors";

export const dynamic = "force-dynamic";

/** GET /api/dashboard/pitch-intel/athletes/:uuid/sessions — Trackman sessions and screenshot reports, with xArsenal grades. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  await requireAuth();
  try {
    const data = await getAthleteSessions((await params).uuid);
    if (!data) return notFound("Athlete not found");
    return success(data);
  } catch (error) {
    console.error("Error in GET /api/dashboard/pitch-intel/athletes/[uuid]/sessions:", error);
    return internalError(apiErrorMessage(error, "Failed to load sessions"));
  }
}
