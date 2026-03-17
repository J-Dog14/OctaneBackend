import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { buildAthleteTrackingReport } from "@/lib/athlete-tracking/report";
import type { DomainId } from "@/lib/athlete-tracking/types";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/requireAuth";

const DOMAIN_IDS: DomainId[] = [
  "pitching",
  "hitting",
  "mobility",
  "athleticScreen",
  "armAction",
  "proteus",
];

const querySchema = z.object({
  athleteUuid: z.string().min(1, "athleteUuid is required"),
});

/**
 * Dashboard-only: athlete tracking report with percentiles per domain.
 * GET /api/dashboard/athlete-tracking/report?athleteUuid=...
 *   Optional per-domain date overrides: &pitchingDate=YYYY-MM-DD &hittingDate=YYYY-MM-DD etc.
 */
export async function GET(request: NextRequest) {
  await requireAuth();
  try {
    const { searchParams } = new URL(request.url);
    const raw = { athleteUuid: searchParams.get("athleteUuid") ?? undefined };
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) {
      return badRequest(
        parsed.error.issues.map((e) => e.message).join(", ")
      );
    }

    // Collect per-domain date overrides from query params (e.g. pitchingDate=2024-01-15)
    const sessionDates: Partial<Record<DomainId, string>> = {};
    for (const domainId of DOMAIN_IDS) {
      const val = searchParams.get(`${domainId}Date`);
      if (val) sessionDates[domainId] = val;
    }

    const report = await buildAthleteTrackingReport(
      parsed.data.athleteUuid,
      Object.keys(sessionDates).length > 0 ? sessionDates : undefined
    );
    return success(report);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Error in GET /api/dashboard/athlete-tracking/report:", error);
    return internalError("Failed to generate athlete tracking report");
  }
}
