import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import type { DomainId } from "@/lib/athlete-tracking/types";
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

    const toDateStrings = (rows: { session_date: Date }[]): string[] => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const r of rows) {
        const s = r.session_date.toISOString().split("T")[0];
        if (!seen.has(s)) {
          seen.add(s);
          out.push(s);
        }
      }
      return out.sort((a, b) => b.localeCompare(a)); // newest first
    };

    // Fetch distinct session dates for each domain in parallel
    const [
      pitchingTrialDates,
      pitchingKinematicsDates,
      hittingDates,
      mobilityDates,
      athleticScreenDates,
      armActionDates,
      proteusDates,
    ] = await Promise.all([
      prisma.f_pitching_trials.findMany({
        where: { athlete_uuid: athleteUuid },
        select: { session_date: true },
        distinct: ["session_date"],
        orderBy: { session_date: "desc" },
      }),
      prisma.f_kinematics_pitching.findMany({
        where: { athlete_uuid: athleteUuid },
        select: { session_date: true },
        distinct: ["session_date"],
        orderBy: { session_date: "desc" },
      }),
      prisma.f_kinematics_hitting.findMany({
        where: { athlete_uuid: athleteUuid },
        select: { session_date: true },
        distinct: ["session_date"],
        orderBy: { session_date: "desc" },
      }),
      prisma.f_mobility.findMany({
        where: { athlete_uuid: athleteUuid },
        select: { session_date: true },
        distinct: ["session_date"],
        orderBy: { session_date: "desc" },
      }),
      prisma.f_athletic_screen_cmj.findMany({
        where: { athlete_uuid: athleteUuid },
        select: { session_date: true },
        distinct: ["session_date"],
        orderBy: { session_date: "desc" },
      }),
      prisma.f_arm_action.findMany({
        where: { athlete_uuid: athleteUuid },
        select: { session_date: true },
        distinct: ["session_date"],
        orderBy: { session_date: "desc" },
      }),
      prisma.f_proteus.findMany({
        where: { athlete_uuid: athleteUuid },
        select: { session_date: true },
        distinct: ["session_date"],
        orderBy: { session_date: "desc" },
      }),
    ]);

    // Merge trials + kinematics dates for pitching
    const pitchingAllDates = [
      ...pitchingTrialDates,
      ...pitchingKinematicsDates,
    ];

    const allDomains: Array<{ domainId: DomainId; dates: string[] }> = [
      { domainId: "pitching" as DomainId, dates: toDateStrings(pitchingAllDates) },
      { domainId: "hitting" as DomainId, dates: toDateStrings(hittingDates) },
      { domainId: "mobility" as DomainId, dates: toDateStrings(mobilityDates) },
      { domainId: "athleticScreen" as DomainId, dates: toDateStrings(athleticScreenDates) },
      { domainId: "armAction" as DomainId, dates: toDateStrings(armActionDates) },
      { domainId: "proteus" as DomainId, dates: toDateStrings(proteusDates) },
    ];
    const domains = allDomains.filter((d) => d.dates.length > 0);

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
