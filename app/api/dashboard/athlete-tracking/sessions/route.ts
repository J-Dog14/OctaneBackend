import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { getTrackingSessionDates } from "@/lib/athlete-tracking/sessionDates";
import { requireAuth } from "@/lib/auth/requireAuth";

const querySchema = z.object({
  athleteUuid: z.string().min(1, "athleteUuid is required"),
});

/**
 * Returns available session dates per domain for an athlete.
 * GET /api/dashboard/athlete-tracking/sessions?athleteUuid=...
 * Response: { domains: Array<{ domainId: DomainId; dates: string[] }> }
 */
export async function GET(request: NextRequest) {
  await requireAuth();
  try {
    const { searchParams } = new URL(request.url);
    const raw = { athleteUuid: searchParams.get("athleteUuid") ?? undefined };
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) {
      return badRequest(parsed.error.issues.map((e) => e.message).join(", "));
    }
    const { athleteUuid } = parsed.data;

    const domains = await getTrackingSessionDates(athleteUuid);

    const athleteRow = await prisma.d_athletes.findUnique({
      where: { athlete_uuid: athleteUuid },
      select: { app_db_last_sent_sessions: true },
    });
    const lastSentSessions =
      (athleteRow?.app_db_last_sent_sessions as Record<string, string> | null) ?? {};

    return success({ domains, lastSentSessions });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Error in GET /api/dashboard/athlete-tracking/sessions:", error);
    return internalError("Failed to fetch session dates");
  }
}
