import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { apiErrorMessage } from "@/lib/pitch-intel/errors";
import { requireAuth } from "@/lib/auth/requireAuth";
import { suggestAthletes } from "@/lib/pitch-intel/links";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/pitch-intel/athlete-matches?name=<Savant player name>
 * Step 2 of linking: closest d_athletes records by fuzzy name match.
 */
export async function GET(request: NextRequest) {
  await requireAuth();
  try {
    const name = new URL(request.url).searchParams.get("name")?.trim() ?? "";
    if (name.length < 2) return badRequest("Enter at least 2 characters");
    return success({ matches: await suggestAthletes(name, 8) });
  } catch (error) {
    console.error("Error in GET /api/dashboard/pitch-intel/athlete-matches:", error);
    return internalError(apiErrorMessage(error, "Failed to match athletes"));
  }
}
