import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { buildAthleteTrackingReport } from "@/lib/athlete-tracking/report";
import { prisma } from "@/lib/db/prisma";
import { lookupOctaneUserByEmail } from "@/lib/octane/octaneUserLookup";
import { requireRole } from "@/lib/auth/requireAuth";

export async function POST(request: NextRequest) {
  try {
    // Use the same auth guard as other /api/dashboard/ routes
    // e.g.: await requireAdmin(request);

    const { athleteUuid, domainIds } = await request.json() as {
      athleteUuid: string;
      domainIds?: string[];
    };
    if (!athleteUuid || typeof athleteUuid !== "string") {
      return badRequest("athleteUuid is required");
    }

    // Fetch athlete — need email and app_db_uuid
    const athlete = await prisma.d_athletes.findUnique({
      where: { athlete_uuid: athleteUuid },
      select: {
        athlete_uuid: true,
        name: true,
        email: true,
        app_db_uuid: true,
      },
    });

    if (!athlete) {
      return badRequest("Athlete not found");
    }

    if (!athlete.email) {
      return badRequest(
        `Athlete "${athlete.name}" has no email set. Set their email first to link an Octane account.`
      );
    }

    // If app_db_uuid is not cached, resolve it now via email lookup
    let appDbUuid = athlete.app_db_uuid;
    if (!appDbUuid) {
      const octaneUserResult = await lookupOctaneUserByEmail(athlete.email);
      if (!octaneUserResult.ok) {
        return badRequest(
          `No Octane account found for email "${athlete.email}". The athlete must create an Octane account first.`
        );
      }
      appDbUuid = octaneUserResult.user.uuid;
      // Cache for future sends
      await prisma.d_athletes.update({
        where: { athlete_uuid: athleteUuid },
        data: { app_db_uuid: octaneUserResult.user.uuid, app_db_synced_at: new Date() },
      });
    }

    // Build full tracking report (all domains with pre-computed percentiles)
    const report = await buildAthleteTrackingReport(athleteUuid);

    if (report.domains.length === 0) {
      return badRequest(
        `No assessment data found for "${athlete.name}". Run at least one assessment first.`
      );
    }

    const domainsToSend =
      Array.isArray(domainIds) && domainIds.length > 0
        ? report.domains.filter((d) => domainIds.includes(d.domainId))
        : report.domains;

    if (domainsToSend.length === 0) {
      return badRequest(
        `No data found for the requested domains (${domainIds?.join(", ") ?? "any"}) for "${athlete.name}".`
      );
    }

    // Validate env config
    const octaneUrl = process.env.OCTANE_APP_API_URL;
    const apiKey = process.env.OCTANE_API_KEY;
    if (!octaneUrl || !apiKey) {
      return internalError(
        "OCTANE_APP_API_URL or BIOMECH_API_KEYS environment variables are not set."
      );
    }

    // POST to Octane ingest endpoint
    const res = await fetch(`${octaneUrl}/api/biomech/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        octaneUserUuid: appDbUuid,
        athleteEmail: athlete.email,
        athleteName: report.athlete.name,
        generatedAt: report.generatedAt,
        domains: domainsToSend,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      console.error("Octane ingest rejected:", res.status, body);
      return internalError(
        `Octane rejected the payload (${res.status}): ${body}`
      );
    }

    return success({
      ok: true,
      athleteName: report.athlete.name,
      domainsCount: report.domains.length,
      domainIds: report.domains.map((d) => d.domainId),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Error in POST /api/dashboard/send-to-octane:", error);
    return internalError("Failed to send to Octane");
  }
}