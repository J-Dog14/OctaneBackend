import { NextRequest } from "next/server";
import { requireApiKey } from "@/lib/auth/requireApiKey";
import { internalError, success } from "@/lib/responses";
import { runPopulationRefreshes } from "@/lib/percentiles/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Cron fallback/worker drain. Header X-API-Key uses existing BIOMECH_API_KEYS. */
export async function POST(request: NextRequest) {
  try {
    requireApiKey(request);
    return success(await runPopulationRefreshes());
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Percentile population refresh failed:", error);
    return internalError("Unable to refresh percentile populations");
  }
}
