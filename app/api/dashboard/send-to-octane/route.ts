import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { buildAthleteTrackingReport } from "@/lib/athlete-tracking/report";
import { prisma } from "@/lib/db/prisma";
import { lookupOctaneUserByEmail } from "@/lib/octane/octaneUserLookup";
import { requireRole } from "@/lib/auth/requireAuth";
import { deriveLevelFromAthlete } from "@/lib/octane/utils";
import type { DomainId } from "@/lib/athlete-tracking/types";

export async function POST(request: NextRequest) {
  await requireRole("admin");  // ← moved outside try block, actually called
  try {
    const { athleteUuid, sessionDates } = await request.json() as {
      athleteUuid: unknown;
      sessionDates?: Partial<Record<DomainId, string>>;
    };

    if (!athleteUuid || typeof athleteUuid !== "string") {
      return badRequest("athleteUuid is required");
    }

    // Fetch athlete — need email and app_db_uuid
    const athlete = await prisma.d_athletes.findUnique({
      where: { athlete_uuid: athleteUuid as string },
      select: {
        athlete_uuid: true,
        name: true,
        email: true,
        app_db_uuid: true,
        age_group: true,
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
    // Fix: use discriminated union correctly
    let appDbUuid = athlete.app_db_uuid;
      if (!appDbUuid) {
        const result = await lookupOctaneUserByEmail(athlete.email);
        if (!result.ok) {
          return badRequest(
            `No Octane account found for email "${athlete.email}". The athlete must create an Octane account first.`
          );
        }
        appDbUuid = result.user.uuid;  // ← result.user.uuid, not result.uuid
        await prisma.d_athletes.update({
          where: { athlete_uuid: athleteUuid },
          data: { app_db_uuid: result.user.uuid, app_db_synced_at: new Date() },
        });
      }


    // Build full tracking report (all domains with pre-computed percentiles)
    const report = await buildAthleteTrackingReport(athleteUuid as string, sessionDates);

    if (report.domains.length === 0) {
      return badRequest(
        `No assessment data found for "${athlete.name}". Run at least one assessment first.`
      );
    }

    // Validate env config
    const octaneUrl = process.env.OCTANE_APP_API_URL;
    const apiKey = process.env.BIOMECH_API_KEYS;
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
        athleteLevel: deriveLevelFromAthlete(athlete),
        domains: report.domains,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      console.error("Octane ingest rejected:", res.status, body);
      return internalError(
        `Octane rejected the payload (${res.status}): ${body}`
      );
    }

    // Record which session dates were just sent per domain
    const sentSessions: Record<string, string> = {};
    for (const domain of report.domains) {
      const chosen = sessionDates?.[domain.domainId as DomainId] ?? null;
      if (chosen) {
        sentSessions[domain.domainId] = chosen;
      }
    }
    await prisma.d_athletes.update({
      where: { athlete_uuid: athleteUuid as string },
      data: {
        app_db_synced_at: new Date(),
        ...(Object.keys(sentSessions).length > 0
          ? { app_db_last_sent_sessions: sentSessions }
          : {}),
      },
    });

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