"use client";

/**
 * One athlete-tracking domain (pitching 3D, hitting, arm action, athletic
 * screen, mobility, Proteus) with its own session / athlete comparison state.
 * Renders the same domain components as the old Athlete Tracking page, so the
 * tables, radars and timelines stay identical; only the state lives here so
 * each coach tab can hold several domains side by side.
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Text } from "@mantine/core";
import type { RadarDataSeries } from "@/app/dashboard/athlete-tracking/MetricRadarChart";
import type { AthleteTrackingReport, DomainWithMetrics } from "@/app/dashboard/athlete-tracking/types";
import { SERIES_COLORS } from "@/app/dashboard/athlete-tracking/constants";
import { getRadarMetricsForDomain, getTimelineMetricKeys, metricsToRadarData } from "@/app/dashboard/athlete-tracking/domainHelpers";
import { GenericDomain } from "@/app/dashboard/athlete-tracking/components/GenericDomain";
import { AthleticScreenDomain } from "@/app/dashboard/athlete-tracking/components/AthleticScreenDomain";
import { ProteusDomain } from "@/app/dashboard/athlete-tracking/components/ProteusDomain";
import { AthleteSearchSelect } from "./AthleteSearchSelect";
import { useCoachFetcher, swrOpts, trackingKey } from "./fetcher";
import type { DomainId } from "@/lib/athlete-tracking/types";

type Props = {
  athleteUuid: string;
  domain: DomainWithMetrics;
  /** Session dates for this domain, newest first. */
  availableDates: string[];
};

type Mode = "none" | "date" | "athlete";

function modeButtonStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: "13px",
    padding: "7px 16px",
    borderRadius: 6,
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "var(--accent-muted)" : "transparent",
    color: active ? "var(--accent)" : "var(--text-secondary)",
    fontWeight: 500,
  };
}

export function DomainWorkspace({ athleteUuid, domain, availableDates }: Props) {
  const coachFetcher = useCoachFetcher();
  const domainId = domain.domainId as DomainId;
  const [mode, setMode] = useState<Mode>("none");
  const [compareDates, setCompareDates] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<Record<string, "compare" | "timeline">>({});
  const [expandedMobilityGroups, setExpandedMobilityGroups] = useState<Record<string, boolean>>({});
  const [athleticScreenSubIndex, setAthleticScreenSubIndex] = useState(0);
  const [expandedAthleticInfo, setExpandedAthleticInfo] = useState<string | null>(null);
  const [compareUuid, setCompareUuid] = useState<string | null>(null);
  const [compareName, setCompareName] = useState<string | null>(null);

  // Session-comparison reports, one request per date (cached per athlete/domain/date).
  const dateReports = useSWR(
    compareDates.length ? ["coach-domain-dates", athleteUuid, domainId, ...compareDates] : null,
    () =>
      Promise.all(
        compareDates.map((date) => coachFetcher<AthleteTrackingReport>(`${trackingKey(athleteUuid, [domainId])}&${encodeURIComponent(`${domainId}Date`)}=${encodeURIComponent(date)}`).catch(() => null)),
      ).then((reports) => Object.fromEntries(compareDates.map((d, i) => [d, reports[i] ?? null]))),
    { keepPreviousData: true, revalidateOnFocus: false },
  );
  const dateCache = useMemo<Record<string, AthleteTrackingReport | null | undefined>>(() => dateReports.data ?? {}, [dateReports.data]);
  const loadingKeys = dateReports.isValidating ? compareDates.filter((d) => dateCache[d] === undefined) : [];

  // Other-athlete report.
  const otherKey = mode === "athlete" && compareUuid && compareUuid !== athleteUuid ? trackingKey(compareUuid, [domainId]) : null;
  const other = useSWR<AthleteTrackingReport>(otherKey, coachFetcher, swrOpts);
  const compareReport = otherKey ? (other.data ?? null) : null;
  const loadingCompare = !!otherKey && other.isLoading;

  const primaryDate = domain.sessionDate;
  const domainForDate = (date: string): DomainWithMetrics | undefined =>
    date === primaryDate ? domain : dateCache[date]?.domains.find((d) => d.domainId === domainId);

  const compDomains = useMemo(() => {
    const out: Array<{ label: string; domain: DomainWithMetrics }> = [];
    if (mode === "date") {
      for (const date of compareDates) {
        const cd = dateCache[date]?.domains.find((d) => d.domainId === domainId);
        if (cd) out.push({ label: date, domain: cd });
      }
    } else if (mode === "athlete" && compareReport) {
      const cd = compareReport.domains.find((d) => d.domainId === domainId);
      if (cd) out.push({ label: compareReport.athlete.name, domain: cd });
    }
    return out;
  }, [mode, compareDates, dateCache, compareReport, domainId]);

  const series: RadarDataSeries[] = [
    {
      name: primaryDate ?? "Latest",
      data: metricsToRadarData(getRadarMetricsForDomain(domain.metrics, domainId), domainId),
      color: SERIES_COLORS[0]!,
    },
    ...compDomains.map(({ label, domain: cd }, i) => ({
      name: label,
      data: metricsToRadarData(getRadarMetricsForDomain(cd.metrics, domainId), domainId),
      color: SERIES_COLORS[i + 1] ?? SERIES_COLORS[SERIES_COLORS.length - 1]!,
    })),
  ];

  const used = new Set([primaryDate, ...compareDates].filter(Boolean));
  const remainingDates = availableDates.filter((d) => !used.has(d));
  const timelineDates = [...new Set([primaryDate, ...compareDates].filter((d): d is string => !!d))].sort((a, b) => b.localeCompare(a));
  const compLoadingKeys = loadingKeys.map((d) => `${domainId}|${d}`);
  const addCompareDate = (_id: string, date: string) => setCompareDates((p) => (p.includes(date) || p.length >= 3 ? p : [...p, date]));
  const removeCompareDate = (_id: string, date: string) => setCompareDates((p) => p.filter((d) => d !== date));
  const toggleMode = (m: Exclude<Mode, "none">) => setMode((cur) => (cur === m ? "none" : m));

  const compareModeButtons = (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
      <button type="button" className="btn-ghost" style={modeButtonStyle(mode === "date")} onClick={() => toggleMode("date")} disabled={availableDates.length < 2}>
        Compare sessions{availableDates.length > 1 ? ` (${availableDates.length})` : ""}
      </button>
      <button type="button" className="btn-ghost" style={modeButtonStyle(mode === "athlete")} onClick={() => toggleMode("athlete")}>
        Compare another athlete
      </button>
      {mode === "athlete" && (
        <>
          <AthleteSearchSelect
            domain={domainId}
            value={compareUuid}
            valueLabel={compareName}
            exclude={[athleteUuid]}
            onChange={(v, name) => {
              setCompareUuid(v);
              setCompareName(name);
            }}
            size="xs"
            w={240}
          />
          {loadingCompare && <Text size="sm" c="dimmed">Loading…</Text>}
          {!loadingCompare && compareReport && !compareReport.domains.some((d) => d.domainId === domainId) && (
            <Text size="sm" c="dimmed">{compareReport.athlete.name} has no {domain.label} data.</Text>
          )}
        </>
      )}
    </div>
  );

  const shared = {
    domain,
    domainMode: mode,
    compareDates,
    compDomains,
    availForDomain: availableDates,
    primaryDate,
    remainingDates,
    compLoadingKeys,
    loadingDates: false,
    compareModeButtons,
    addCompareDate,
    removeCompareDate,
  };

  if (domainId === "athleticScreen") {
    return (
      <AthleticScreenDomain
        {...shared}
        athleticScreenSubIndex={athleticScreenSubIndex}
        setAthleticScreenSubIndex={setAthleticScreenSubIndex}
        expandedAthleticInfo={expandedAthleticInfo}
        setExpandedAthleticInfo={setExpandedAthleticInfo}
      />
    );
  }
  if (domainId === "proteus") return <ProteusDomain {...shared} />;
  return (
    <GenericDomain
      {...shared}
      viewMode={viewMode[domainId] ?? "compare"}
      series={series}
      timelineKeys={getTimelineMetricKeys(domainId)}
      timelineDates={timelineDates}
      expandedMobilityGroups={expandedMobilityGroups}
      setExpandedMobilityGroups={setExpandedMobilityGroups}
      setDomainViewMode={setViewMode}
      getDomainForDate={domainForDate}
    />
  );
}

/** Picks one of several domains with a segmented row, then renders its workspace. */
export function DomainSwitcher({
  athleteUuid,
  domains,
  datesByDomain,
  emptyText,
}: {
  athleteUuid: string;
  domains: DomainWithMetrics[];
  datesByDomain: Partial<Record<string, string[]>>;
  emptyText: string;
}) {
  const [active, setActive] = useState<string | null>(domains[0]?.domainId ?? null);
  const current = domains.find((d) => d.domainId === active) ?? domains[0];
  if (!current) return <Text c="dimmed">{emptyText}</Text>;
  return (
    <div>
      {domains.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: "1rem", flexWrap: "wrap" }}>
          {domains.map((d) => (
            <button key={d.domainId} type="button" className="btn-ghost" style={modeButtonStyle(d.domainId === current.domainId)} onClick={() => setActive(d.domainId)}>
              {d.label}
              {d.sessionDate ? <span style={{ opacity: 0.6, marginLeft: 6 }}>{d.sessionDate}</span> : null}
            </button>
          ))}
        </div>
      )}
      <DomainWorkspace key={`${athleteUuid}:${current.domainId}`} athleteUuid={athleteUuid} domain={current} availableDates={datesByDomain[current.domainId] ?? []} />
    </div>
  );
}

