import { NextRequest } from "next/server";
import { requireApiKey } from "@/lib/auth/requireApiKey";
import { internalError, success } from "@/lib/responses";
import { runNightly } from "@/lib/pitch-intel/pull";

export const dynamic = "force-dynamic";

/**
 * POST /api/biomech/pitch-intel/nightly
 * Header: X-API-Key: <one of BIOMECH_API_KEYS>
 *
 * Re-pulls every enabled Savant link from (last game - 7 days) through today.
 * Called once a night by the Railway cron service; safe to call by hand.
 * Responds when the run finishes (a few seconds per athlete).
 */
export async function POST(request: NextRequest) {
  try {
    requireApiKey(request);
    const summary = await runNightly({ log: (line) => console.log(`[pitch-intel nightly] ${line}`) });
    return success({
      skipped: summary.skipped,
      reason: summary.reason ?? null,
      date: summary.date,
      ok: summary.ok,
      flagged: summary.flagged,
      failed: summary.failed,
      results: summary.results.map((r) => ({
        linkId: r.linkId,
        athlete: r.athleteName,
        status: r.status,
        inserted: r.inserted,
        updated: r.updated,
        error: r.error,
      })),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Error in POST /api/biomech/pitch-intel/nightly:", error);
    return internalError("Nightly pull failed");
  }
}
