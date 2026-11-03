import { requireCoach } from "@/lib/coach/access";
import { internalError, success } from "@/lib/responses";
import { cachedPopulationStatus } from "@/lib/percentiles/populations";

export const dynamic = "force-dynamic";

/** Only generation/status counts; no source athlete records are exposed. */
export async function GET() {
  const denied = await requireCoach();
  if (denied) return denied;
  try {
    const response = success(await cachedPopulationStatus());
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return internalError("Percentile population status unavailable");
  }
}
