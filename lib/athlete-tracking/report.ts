/**
 * Builds the full athlete tracking report (athlete, counts, domains with percentiles).
 */

import { buildAthleteReportPayload } from "@/lib/octane/reportPayload";
import { buildDomainsWithPercentiles } from "@/lib/athlete-tracking/percentiles";
import type { AthleteTrackingReport, DomainId } from "@/lib/athlete-tracking/types";

export async function buildAthleteTrackingReport(
  athleteUuid: string,
  sessionDates?: Partial<Record<DomainId, string>>
): Promise<AthleteTrackingReport> {
  const reportPayload = await buildAthleteReportPayload(athleteUuid);
  const domains = await buildDomainsWithPercentiles(
    athleteUuid,
    reportPayload.counts,
    sessionDates
  );

  return {
    generatedAt: reportPayload.generatedAt,
    athlete: {
      athleteUuid: reportPayload.athlete.athleteUuid,
      name: reportPayload.athlete.name,
      dateOfBirth: reportPayload.athlete.dateOfBirth,
      gender: reportPayload.athlete.gender,
      height: reportPayload.athlete.height,
      weight: reportPayload.athlete.weight,
      email: reportPayload.athlete.email,
    },
    counts: reportPayload.counts,
    domains,
  };
}
