import type { CoachAthleteSummary } from "@/lib/coach/summary";
import type { PitchSessionRef } from "@/lib/coach/pitchLog";
import { assessmentsKey, pitchingKey, readinessKey, trackingKey } from "./fetcher";

/** Warm default tab views, without downloading every historical pitch/session. */
export function athleteWarmKeys(summary: CoachAthleteSummary): string[] {
  const uuid = summary.athlete.athleteUuid;
  const base = `/api/coach/athletes/${encodeURIComponent(uuid)}`;
  return [
    trackingKey(uuid),
    ...(summary.tabs.pitching ? [pitchingKey(uuid), `${base}/pitches/sessions`, `${base}/pitches/trends`] : []),
    ...(summary.tabs.readiness ? [readinessKey(uuid)] : []),
    ...(summary.trackingDomains.includes("pitching") ? [`${base}/biomech-report`] : []),
    ...(summary.tabs.hitting ? [`${base}/hitting-report`] : []),
    ...(summary.tabs.assessments ? [`${base}/athletic-screen-report`] : []),
    ...(summary.tabs.mobility ? [`${base}/mobility`] : []),
    ...(summary.tabs.prosup ? [`${base}/pro-sup-report`] : []),
    ...(summary.tabs.prosup || summary.tabs.curveball ? [assessmentsKey(uuid)] : []),
    ...(summary.tabs.program ? [`${base}/program`] : []),
    ...(summary.tabs.throwing ? [`${base}/program-throwing`] : []),
  ];
}

/** Also warms the newest session used by the Pitch report's default view. */
export function latestPitchKey(sessionsUrl: string, data: unknown): string | null {
  const sessions = (data as { sessions?: PitchSessionRef[] } | undefined)?.sessions;
  return sessions?.[0] ? `${sessionsUrl.slice(0, -"/sessions".length)}?session=${encodeURIComponent(sessions[0].key)}` : null;
}

/** Two workers cap background load; stop scheduling when the athlete changes. */
export async function warmAthleteData(
  summary: CoachAthleteSummary,
  load: (key: string) => Promise<unknown>,
  cancelled: () => boolean,
): Promise<void> {
  const primary = [trackingKey(summary.athlete.athleteUuid),
    ...(summary.tabs.pitching ? [pitchingKey(summary.athlete.athleteUuid)] : []),
    ...(summary.tabs.readiness ? [readinessKey(summary.athlete.athleteUuid)] : [])];
  // Let the overview's foreground requests finish before starting other reports.
  await Promise.allSettled(primary.map(load));
  const queue = athleteWarmKeys(summary).filter((key) => !primary.includes(key));
  async function worker() {
    while (!cancelled() && queue.length) {
      const key = queue.shift()!;
      try {
        const data = await load(key);
        if (!cancelled() && key.endsWith("/pitches/sessions")) {
          const latest = latestPitchKey(key, data);
          if (latest) await load(latest);
        }
      } catch {
        // Optional warming must never break the page or suppress a later retry.
      }
    }
  }
  await Promise.all([worker(), worker()]);
}
