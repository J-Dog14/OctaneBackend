import type { AthleteTrackingReport } from "@/lib/athlete-tracking/types";
import type { CoachAthleteSummary, CurveballSession, ProSupSession } from "@/lib/coach/summary";
import type { CoachPitching } from "@/lib/coach/pitching";
import type { ReadinessDashboardPayload } from "@/app/dashboard/readiness-screen/types";
import { comparisonDomains, hasComparisonData, type ComparisonScope } from "@/lib/coach/comparison";
import { assessmentsKey, pitchingKey, readinessKey, summaryKey, trackingKey } from "./fetcher";
import type { coachFetcher } from "./fetcher";

export type AthleteBundle = {
  uuid: string;
  summary: CoachAthleteSummary;
  available: boolean;
  tracking: AthleteTrackingReport | null;
  pitching: CoachPitching | null;
  readiness: ReadinessDashboardPayload | null;
  assessments: { proSup: ProSupSession[]; curveball: CurveballSession[] } | null;
};

export async function loadComparisonBundles(fetcher: typeof coachFetcher, ids: string[], scope: ComparisonScope): Promise<AthleteBundle[]> {
  return Promise.all(ids.map(async (uuid) => {
    const summary = await fetcher<CoachAthleteSummary>(summaryKey(uuid));
    const available = hasComparisonData(summary, scope);
    const base = { uuid, summary, available, tracking: null, pitching: null, readiness: null, assessments: null };
    if (!available) return base;
    const broad = scope === "all" || scope === "overview";
    const domains = comparisonDomains(scope).filter((id) => summary.trackingDomains.includes(id));
    const assessmentKind = scope === "prosup" || scope === "curveball" ? scope : undefined;
    const [tracking, pitching, readiness, assessments] = await Promise.all([
      domains.length ? fetcher<AthleteTrackingReport>(trackingKey(uuid, broad ? undefined : domains)) : null,
      (broad || scope === "pitching") && hasComparisonData(summary, "pitching") ? fetcher<CoachPitching>(pitchingKey(uuid)) : null,
      (broad || scope === "readiness") && summary.tabs.readiness ? fetcher<ReadinessDashboardPayload>(readinessKey(uuid)) : null,
      (assessmentKind || (scope === "all" && (summary.tabs.prosup || summary.tabs.curveball)))
        ? fetcher<NonNullable<AthleteBundle["assessments"]>>(assessmentsKey(uuid, assessmentKind)) : null,
    ]);
    return { ...base, tracking, pitching, readiness, assessments };
  }));
}
