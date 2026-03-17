import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { octaneReportPayloadQuerySchema } from "@/lib/validation/octane";
import { buildAthleteReportPayload } from "@/lib/octane/reportPayload";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/requireAuth";

/**
 * Dashboard-only: generate report payload(s). No API key.
 * GET ?athleteUuid=... for one, or ?limit=25 for batch.
 */
export async function GET(request: NextRequest) {
  await requireAuth();
  try {
    const { searchParams } = new URL(request.url);
    const rawQuery = {
      athleteUuid: searchParams.get("athleteUuid") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      latestOnly: searchParams.get("latestOnly") ?? undefined,
    };
    const queryValidation = octaneReportPayloadQuerySchema.safeParse(rawQuery);
    if (!queryValidation.success) {
      return badRequest(
        queryValidation.error.issues.map((e) => e.message).join(", ")
      );
    }
    const { athleteUuid, limit } = queryValidation.data;

    if (athleteUuid) {
      const payload = await buildAthleteReportPayload(athleteUuid);
      return success(payload);
    }

    const athletes = await prisma.d_athletes.findMany({
      take: limit ?? 25,
      orderBy: { created_at: "desc" },
      select: { athlete_uuid: true },
    });
    const payloads = await Promise.all(
      athletes.map((a) => buildAthleteReportPayload(a.athlete_uuid))
    );
    return success({
      generatedAt: new Date().toISOString(),
      count: payloads.length,
      payloads,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Error in GET /api/dashboard/payloads/report:", error);
    return internalError("Failed to generate report payload(s)");
  }
}
