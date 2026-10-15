"use client";

import useSWR from "swr";
import { Badge, Group, SimpleGrid, Stack, Text, UnstyledButton } from "@mantine/core";
import type { CoachAthleteSummary } from "@/lib/coach/summary";
import type { CoachPitching, VeloPoint } from "@/lib/coach/pitching";
import type { ReadinessDashboardPayload } from "@/app/dashboard/readiness-screen/types";
import { HighlightsLowlightsCard } from "@/app/dashboard/athlete-tracking/components/HighlightsLowlightsCard";
import { getHighlightsAndLowlights, getMetricByKey } from "@/app/dashboard/athlete-tracking/domainHelpers";
import { daysAgo, fmt, fmtDate, pitchingKey, readinessKey, swrOpts } from "../_components/fetcher";
import { ArsenalBadge, MovementPlot, PitchTypeTable, VeloTrendChart } from "../_components/pitching";
import { SectionHead, StatTile, useTracking } from "./shared";

const BAND: Record<string, { label: string; tone: "up" | "flat" | "down" }> = {
  READY: { label: "Ready to train", tone: "up" },
  CAUTION: { label: "Monitor load", tone: "flat" },
  FATIGUED: { label: "Modify training", tone: "down" },
};

/** Left out of the overview highlights / lowlights: power-curve shape and timing metrics that aren't "higher is better". */
const HIGHLIGHT_EXCLUDE = /kurtosis|time[ _-]?to[ _-]?(max[ _-]?)?rpd|\bauc\b|auc_j|\bwork\b/i;

/** Newest fastball reading (FF, else SI) and the best of the last 365 days. */
function fastballStats(velo: VeloPoint[]) {
  const fb = velo.filter((p) => p.pitchType === "FF" || p.pitchType === "SI");
  if (!fb.length) return null;
  const primary = fb.some((p) => p.pitchType === "FF") ? "FF" : "SI";
  const series = fb.filter((p) => p.pitchType === primary);
  const latest = series[series.length - 1]!;
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const recent = series.filter((p) => p.date >= yearAgo);
  const peak = Math.max(...recent.map((p) => p.veloMax ?? p.velo));
  return { primary, latest, peak: Number.isFinite(peak) ? peak : null };
}

export function OverviewTab({
  athleteUuid,
  summary,
  onOpenTab,
}: {
  athleteUuid: string;
  summary: CoachAthleteSummary;
  onOpenTab: (tab: string) => void;
}) {
  const tracking = useTracking(athleteUuid);
  const pitching = useSWR<CoachPitching>(summary.tabs.pitching ? pitchingKey(athleteUuid) : null, swrOpts);
  const readiness = useSWR<ReadinessDashboardPayload>(summary.tabs.readiness ? readinessKey(athleteUuid) : null, swrOpts);

  const domains = tracking.data?.domains ?? [];
  const { highlights, lowlights } = getHighlightsAndLowlights(domains, { count: 5, exclude: HIGHLIGHT_EXCLUDE });
  const latestScore = readiness.data?.latest_score ?? null;
  const band = latestScore?.band ? BAND[latestScore.band] : undefined;
  const fb = pitching.data ? fastballStats(pitching.data.velo) : null;
  const latest = pitching.data?.latest ?? null;
  const pitching3d = domains.find((d) => d.domainId === "pitching");
  const captureVelo = pitching3d ? getMetricByKey(pitching3d.metrics, "TRACKMAN_METRICS|VELOCITY") : null;

  return (
    <Stack gap="lg">
      <div className="stat-grid" style={{ marginTop: 0 }}>
        <StatTile
          label="Readiness"
          value={latestScore?.composite_score != null ? Math.round(latestScore.composite_score) : "—"}
          sub={latestScore ? `${band?.label ?? "No band"} · ${fmtDate(latestScore.date)}` : summary.tabs.readiness ? "Loading…" : "No screens yet"}
          tone={band?.tone}
        />
        <StatTile
          label={fb ? `${fb.primary === "FF" ? "4-seam" : "Sinker"} velo (latest)` : "Fastball velo"}
          value={fb ? fmt(fb.latest.velo) : "—"}
          sub={fb ? `${fmtDate(fb.latest.date)} · ${fb.latest.sessionType} · 12-mo peak ${fmt(fb.peak)}` : "No pitch data"}
        />
        <StatTile
          label="Arsenal grade"
          value={latest?.arsenal ? latest.arsenal.grade : "—"}
          sub={latest?.arsenal ? `${latest.arsenal.label} · ${latest.label}` : "Needs 5+ pitches per type"}
        />
        <StatTile
          label="Last 3D capture"
          value={pitching3d?.sessionDate ? `${daysAgo(pitching3d.sessionDate)}d` : "—"}
          sub={
            pitching3d?.sessionDate
              ? `${fmtDate(pitching3d.sessionDate)}${captureVelo?.value != null ? ` · ${fmt(captureVelo.value)} mph in lab` : ""}`
              : "No pitching capture"
          }
        />
      </div>

      {domains.length > 0 && <HighlightsLowlightsCard highlights={highlights} lowlights={lowlights} />}

      {pitching.data?.hasAnyData && (
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <div className="card" style={{ marginBottom: 0 }}>
            <Group justify="space-between" mb="xs">
              <SectionHead title="Current arsenal" sub={latest?.label} />
              <ArsenalBadge arsenal={latest?.arsenal ?? null} size="md" />
            </Group>
            {latest ? (
              <>
                <MovementPlot sets={[{ name: latest.label, rows: latest.byType, throws: pitching.data?.athlete.throws ?? summary.athlete.throws }]} height={260} />
                <PitchTypeTable rows={latest.byType} compact />
              </>
            ) : (
              <Text size="sm" c="dimmed">Not enough pitches to grade yet.</Text>
            )}
          </div>
          <div className="card" style={{ marginBottom: 0 }}>
            <SectionHead title="Velocity trend" sub="Savant games + Trackman" />
            <VeloTrendChart points={pitching.data.velo} height={300} />
          </div>
        </SimpleGrid>
      )}

      <div className="card">
        <SectionHead title="Data on file" sub="click to open" />
        {summary.sources.length === 0 ? (
          <Text size="sm" c="dimmed">Nothing collected for this athlete yet.</Text>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
            {summary.sources.map((s) => (
              <UnstyledButton
                key={s.id}
                onClick={() => onOpenTab(s.tab)}
                style={{ padding: "8px 10px", borderRadius: 8, background: "var(--bg-inset)", border: "1px solid var(--border-soft)" }}
              >
                <Group justify="space-between" wrap="nowrap">
                  <Text size="sm" fw={500}>{s.label}</Text>
                  <Badge size="sm" variant="light" color="gray">{s.sessions}</Badge>
                </Group>
                <Text size="xs" c="dimmed">Last {fmtDate(s.lastDate)}</Text>
              </UnstyledButton>
            ))}
          </SimpleGrid>
        )}
      </div>
    </Stack>
  );
}
