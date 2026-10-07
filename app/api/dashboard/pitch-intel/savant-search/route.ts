import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { requireAuth } from "@/lib/auth/requireAuth";
import { findSavantPlayers } from "@/lib/pitch-intel/links";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/pitch-intel/savant-search?q=<name | MLB ID | Savant URL>
 * Step 1 of linking: Savant players matching the query, pitchers first.
 */
export async function GET(request: NextRequest) {
  await requireAuth();
  try {
    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return badRequest("Enter at least 2 characters");
    const players = await findSavantPlayers(q);
    return success({ players: players.slice(0, 15) });
  } catch (error) {
    console.error("Error in GET /api/dashboard/pitch-intel/savant-search:", error);
    return internalError(error instanceof Error ? error.message : "Savant search failed");
  }
}
