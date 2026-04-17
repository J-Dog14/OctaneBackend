"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import {
  Select,
  Tabs,
  TabsList,
  TabsTab,
  Title,
  Text,
  Stack,
} from "@mantine/core";
import type { RadarDataSeries } from "./MetricRadarChart";
import { AthleteSelectionPanel } from "./components/AthleteSelectionPanel";
import { HighlightsLowlightsCard } from "./components/HighlightsLowlightsCard";
import { AthleticScreenDomain } from "./components/AthleticScreenDomain";
import { ProteusDomain } from "./components/ProteusDomain";
import { GenericDomain } from "./components/GenericDomain";
import type { AthleteItem, MetricWithPercentile, DomainWithMetrics, AthleteTrackingReport } from "./types";
import { SERIES_COLORS } from "./constants";
import {
  metricsToRadarData,
  getHighlightsAndLowlights,
  getRadarMetricsForDomain,
  getTimelineMetricKeys,
} from "./domainHelpers";

function AthleteTrackingContentInner() {
  const searchParams = useSearchParams();
  const initialAthlete = searchParams.get("athlete") ?? "";
  const initialCurrent = searchParams.get("current") ?? "";

  const [searchResults, setSearchResults] = useState<AthleteItem[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  /** Names looked up so far; used for tracked-athlete badge labels. */
  const [knownNames, setKnownNames] = useState<Record<string, string>>({});
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlPreloadDoneRef = useRef(false);
  const [trackedUuids, setTrackedUuids] = useState<string[]>([]);
  const [currentUuid, setCurrentUuid] = useState<string>("");
  const [report, setReport] = useState<AthleteTrackingReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [athleticScreenSubIndex, setAthleticScreenSubIndex] = useState(0);
  const [expandedMobilityGroups, setExpandedMobilityGroups] = useState<Record<string, boolean>>({});
  const [addAthleteQuery, setAddAthleteQuery] = useState("");

  // --- Session date comparison (primary mode) ---
  const [availableDates, setAvailableDates] = useState<Record<string, string[]>>({});
  const [loadingDates, setLoadingDates] = useState(false);
  // domainId -> array of comparison dates (up to 3)
  const [domainCompareDates, setDomainCompareDates] = useState<Record<string, string[]>>({});
  // keyed by "domainId|date"; undefined = not fetched, null = failed, report = success
  const [compCache, setCompCache] = useState<Record<string, AthleteTrackingReport | null | undefined>>({});
  const [compLoadingKeys, setCompLoadingKeys] = useState<string[]>([]);
  // per domain: "compare" (radar) | "timeline"
  const [domainViewMode, setDomainViewMode] = useState<Record<string, "compare" | "timeline">>({});

  // --- Cross-athlete comparison (secondary) ---
  const [domainCompareMode, setDomainCompareMode] = useState<Record<string, "none" | "date" | "athlete">>({});
  const [compareUuid, setCompareUuid] = useState<string | null>(null);
  const [compareReport, setCompareReport] = useState<AthleteTrackingReport | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [expandedAthleticInfo, setExpandedAthleticInfo] = useState<string | null>(null);

  const searchAthletes = useCallback(async (q: string) => {
    setLoadingSearch(true);
    const params = new URLSearchParams({ limit: "40" });
    if (q.trim()) params.set("q", q.trim());
    try {
      const res = await fetch(`/api/dashboard/athletes?${params}`);
      const data = await res.json();
      const items: AthleteItem[] = data.items ?? [];
      setSearchResults(items);
      setKnownNames((prev) => {
        const next = { ...prev };
        for (const a of items) next[a.athlete_uuid] = a.name;
        return next;
      });
    } finally {
      setLoadingSearch(false);
    }
  }, []);

  // Initial load via SWR — cached for 60s so navigating back doesn't re-fetch.
  const { data: initialAthletes } = useSWR<AthleteItem[]>(
    "/api/dashboard/athletes?limit=40",
    (url: string) => fetch(url).then((r) => r.json()).then((d) => d.items ?? []),
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );
  useEffect(() => {
    if (initialAthletes?.length && searchResults.length === 0) {
      setSearchResults(initialAthletes);
    }
  }, [initialAthletes, searchResults.length]);

  // Debounce search-box input.
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      void searchAthletes(addAthleteQuery);
    }, 200);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [addAthleteQuery, searchAthletes]);

  // Handle URL-preloaded athletes — runs once, no longer gated on a full athlete list.
  useEffect(() => {
    if (urlPreloadDoneRef.current || !initialAthlete) return;
    urlPreloadDoneRef.current = true;
    const uuids = initialAthlete.split(",").map((s) => s.trim()).filter(Boolean);
    if (uuids.length > 0) {
      setTrackedUuids((prev) => Array.from(new Set([...prev, ...uuids])));
      if (initialCurrent && uuids.includes(initialCurrent)) {
        setCurrentUuid(initialCurrent);
      } else if (!currentUuid) {
        setCurrentUuid(uuids[0]!);
      }
    }
  }, [initialAthlete, initialCurrent]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (trackedUuids.length > 0) params.set("athlete", trackedUuids.join(","));
    if (currentUuid) params.set("current", currentUuid);
    const q = params.toString();
    const path = `/dashboard/athlete-tracking${q ? `?${q}` : ""}`;
    if (typeof window !== "undefined" && window.location.pathname + window.location.search !== path) {
      window.history.replaceState(null, "", path);
    }
  }, [trackedUuids, currentUuid]);

  const fetchReport = useCallback(async (athleteUuid: string) => {
    setLoadingReport(true);
    setReportError(null);
    try {
      const res = await fetch(
        `/api/dashboard/athlete-tracking/report?athleteUuid=${encodeURIComponent(athleteUuid)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setReportError(data.error ?? "Failed to load report");
        setReport(null);
        return;
      }
      setReport(data);
      setPageIndex(0);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Request failed");
      setReport(null);
    } finally {
      setLoadingReport(false);
    }
  }, []);

  useEffect(() => {
    if (currentUuid) {
      fetchReport(currentUuid);
      // Reset per-athlete state
      setDomainCompareDates({});
      setCompCache({});
      setCompLoadingKeys([]);
      setDomainViewMode({});
      setDomainCompareMode({});
      setAvailableDates({});
      setCompareReport(null);
      setCompareUuid(null);
    }
  }, [currentUuid, fetchReport]);

  // Cache athlete name once a report loads (used for tracked-athlete badge labels).
  useEffect(() => {
    if (report?.athlete) {
      setKnownNames((prev) => ({
        ...prev,
        [report.athlete.athleteUuid]: report.athlete.name,
      }));
    }
  }, [report]);

  useEffect(() => {
    const domain = report?.domains[pageIndex - 1];
    if (domain?.domainId === "athleticScreen") {
      setAthleticScreenSubIndex(0);
    }
  }, [report, pageIndex]);

  // Fetch available session dates when athlete changes
  useEffect(() => {
    if (!currentUuid) {
      setAvailableDates({});
      return;
    }
    setLoadingDates(true);
    fetch(`/api/dashboard/athlete-tracking/sessions?athleteUuid=${encodeURIComponent(currentUuid)}`)
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, string[]> = {};
        for (const { domainId, dates } of data.domains ?? []) {
          map[domainId] = dates;
        }
        setAvailableDates(map);
      })
      .catch(() => setAvailableDates({}))
      .finally(() => setLoadingDates(false));
  }, [currentUuid]);

  // Cross-athlete compare fetch
  useEffect(() => {
    const anyAthleteMode = Object.values(domainCompareMode).some((m) => m === "athlete");
    if (!anyAthleteMode || !compareUuid || compareUuid === currentUuid) {
      setCompareReport(null);
      return;
    }
    setLoadingCompare(true);
    setCompareReport(null);
    fetch(`/api/dashboard/athlete-tracking/report?athleteUuid=${encodeURIComponent(compareUuid)}`)
      .then(async (res) => {
        const data = await res.json();
        return res.ok ? data : null;
      })
      .then((data) => setCompareReport(data))
      .catch(() => setCompareReport(null))
      .finally(() => setLoadingCompare(false));
  }, [domainCompareMode, compareUuid, currentUuid]);

  // Fetch comparison reports for date-based comparisons
  useEffect(() => {
    if (!currentUuid) return;
    const toFetch: Array<{ domainId: string; date: string; key: string }> = [];
    for (const [domainId, dates] of Object.entries(domainCompareDates)) {
      for (const date of dates) {
        const key = `${domainId}|${date}`;
        if (compCache[key] === undefined && !compLoadingKeys.includes(key)) {
          toFetch.push({ domainId, date, key });
        }
      }
    }
    if (toFetch.length === 0) return;

    setCompLoadingKeys((prev) => [...prev, ...toFetch.map((f) => f.key)]);

    for (const { domainId, date, key } of toFetch) {
      const url = `/api/dashboard/athlete-tracking/report?athleteUuid=${encodeURIComponent(currentUuid)}&${encodeURIComponent(domainId + "Date")}=${encodeURIComponent(date)}`;
      fetch(url)
        .then(async (res) => {
          const data = await res.json();
          setCompCache((prev) => ({ ...prev, [key]: res.ok ? data : null }));
        })
        .catch(() => {
          setCompCache((prev) => ({ ...prev, [key]: null }));
        })
        .finally(() => {
          setCompLoadingKeys((prev) => prev.filter((k) => k !== key));
        });
    }
  }, [domainCompareDates, currentUuid, compCache, compLoadingKeys]);

  const selectAthlete = (uuid: string, name?: string) => {
    if (name) setKnownNames((prev) => ({ ...prev, [uuid]: name }));
    setTrackedUuids([uuid]);
    setCurrentUuid(uuid);
    setAddAthleteQuery("");
  };

  const addTracked = (uuid: string, name?: string) => {
    if (name) setKnownNames((prev) => ({ ...prev, [uuid]: name }));
    if (trackedUuids.includes(uuid)) return;
    setTrackedUuids((prev) => [...prev, uuid]);
    if (!currentUuid) setCurrentUuid(uuid);
  };

  const removeTracked = (uuid: string) => {
    setTrackedUuids((prev) => prev.filter((id) => id !== uuid));
    if (currentUuid === uuid) {
      const next = trackedUuids.filter((id) => id !== uuid);
      setCurrentUuid(next[0] ?? "");
    }
  };

  const addCompareDate = (domainId: string, date: string) => {
    setDomainCompareDates((prev) => {
      const existing = prev[domainId] ?? [];
      if (existing.includes(date) || existing.length >= 3) return prev;
      return { ...prev, [domainId]: [...existing, date] };
    });
  };

  const removeCompareDate = (domainId: string, date: string) => {
    setDomainCompareDates((prev) => {
      const existing = prev[domainId] ?? [];
      return { ...prev, [domainId]: existing.filter((d) => d !== date) };
    });
  };

  const { highlights, lowlights } =
    report && report.domains.length > 0
      ? getHighlightsAndLowlights(report.domains)
      : { highlights: [] as Array<{ domainLabel: string; domainId: string; metric: MetricWithPercentile }>, lowlights: [] as Array<{ domainLabel: string; domainId: string; metric: MetricWithPercentile }> };

  return (
    <Stack gap="lg">
      <div>
        <Title order={1} mb={4}>Athlete Tracking</Title>
        <Text c="dimmed">
          Select an athlete to view percentiles by domain and compare sessions over time.
        </Text>
      </div>

      <AthleteSelectionPanel
        searchResults={searchResults}
        addAthleteQuery={addAthleteQuery}
        onSearchChange={setAddAthleteQuery}
        loadingSearch={loadingSearch}
        trackedUuids={trackedUuids}
        currentUuid={currentUuid}
        knownNames={knownNames}
        onSelect={(uuid) => {
          const athlete = searchResults.find((a) => a.athlete_uuid === uuid);
          selectAthlete(uuid, athlete?.name);
        }}
        onSetCurrent={setCurrentUuid}
        onRemove={removeTracked}
      />

      {!currentUuid && (
        <p className="text-muted">
          <Link href="/dashboard">Back to dashboard</Link>
        </p>
      )}

      {currentUuid && (
        <>
          {loadingReport && (
            <div className="card" style={{ marginBottom: "1rem" }}>
              <p className="text-muted">Loading report…</p>
            </div>
          )}
          {reportError && (
            <div className="card" style={{ marginBottom: "1rem", borderColor: "var(--accent-secondary)" }}>
              <p className="text-danger">{reportError}</p>
            </div>
          )}
          {report && !loadingReport && (
            <>
              <div style={{ marginBottom: "1rem" }}>
                <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.1rem" }}>
                  {report.athlete.name}
                </h2>

                {/* Domain tabs */}
                {(() => {
                  const tabValue =
                    pageIndex === 0
                      ? "__highlights__"
                      : (report.domains[pageIndex - 1]?.domainId ?? "__highlights__");
                  return (
                    <Tabs
                      value={tabValue}
                      onChange={(v) => {
                        if (!v || v === "__highlights__") { setPageIndex(0); return; }
                        const idx = report.domains.findIndex((d) => d.domainId === v);
                        if (idx !== -1) setPageIndex(idx + 1);
                      }}
                      variant="pills"
                      keepMounted={false}
                    >
                      <TabsList mb="md" style={{ flexWrap: "wrap", gap: 4 }}>
                        <TabsTab value="__highlights__">Highlights vs Lowlights</TabsTab>
                        {report.domains.map((d) => (
                          <TabsTab key={d.domainId} value={d.domainId}>
                            {d.sessionDate ? `${d.label} (${d.sessionDate})` : d.label}
                          </TabsTab>
                        ))}
                      </TabsList>
                    </Tabs>
                  );
                })()}
              </div>

              {pageIndex === 0 && (
                <HighlightsLowlightsCard highlights={highlights} lowlights={lowlights} />
              )}

              {pageIndex >= 1 && report.domains[pageIndex - 1] && (() => {
                const domain = report.domains[pageIndex - 1]!;
                const compareDates = domainCompareDates[domain.domainId] ?? [];
                const viewMode = domainViewMode[domain.domainId] ?? "compare";
                const domainMode = domainCompareMode[domain.domainId] ?? "none";
                const toggleDomainMode = (mode: "date" | "athlete") => {
                  setDomainCompareMode((prev) => ({
                    ...prev,
                    [domain.domainId]: prev[domain.domainId] === mode ? "none" : mode,
                  }));
                };

                const radarMetrics = getRadarMetricsForDomain(domain.metrics, domain.domainId);
                const series: RadarDataSeries[] = [
                  {
                    name: domain.sessionDate ?? "Latest",
                    data: metricsToRadarData(radarMetrics, domain.domainId),
                    color: SERIES_COLORS[0]!,
                  },
                ];
                if (domainMode === "date") {
                  compareDates.forEach((date, i) => {
                    const key = `${domain.domainId}|${date}`;
                    const cached = compCache[key];
                    if (cached) {
                      const compDomain = cached.domains.find((d) => d.domainId === domain.domainId);
                      if (compDomain) {
                        const compRadar = getRadarMetricsForDomain(compDomain.metrics, domain.domainId);
                        series.push({
                          name: date,
                          data: metricsToRadarData(compRadar, domain.domainId),
                          color: SERIES_COLORS[i + 1] ?? SERIES_COLORS[SERIES_COLORS.length - 1]!,
                        });
                      }
                    }
                  });
                } else if (domainMode === "athlete" && compareReport) {
                  const compareDomain = compareReport.domains.find((d) => d.domainId === domain.domainId);
                  if (compareDomain) {
                    const compRadar = getRadarMetricsForDomain(compareDomain.metrics, domain.domainId);
                    series.push({
                      name: compareReport.athlete.name,
                      data: metricsToRadarData(compRadar, domain.domainId),
                      color: SERIES_COLORS[1]!,
                    });
                  }
                }

                const availForDomain = availableDates[domain.domainId] ?? [];
                const primaryDate = domain.sessionDate;
                const usedDates = new Set([primaryDate, ...compareDates].filter(Boolean));
                const remainingDates = availForDomain.filter((d) => !usedDates.has(d));

                const timelineKeys = getTimelineMetricKeys(domain.domainId);
                const timelineDates: string[] = [];
                if (primaryDate) timelineDates.push(primaryDate);
                for (const d of compareDates) {
                  if (!timelineDates.includes(d)) timelineDates.push(d);
                }
                timelineDates.sort((a, b) => b.localeCompare(a));

                const getDomainForDate = (date: string): DomainWithMetrics | undefined => {
                  if (date === primaryDate) return domain;
                  const key = `${domain.domainId}|${date}`;
                  const cached = compCache[key];
                  if (!cached) return undefined;
                  return cached.domains.find((d) => d.domainId === domain.domainId);
                };

                const compDomains: Array<{ label: string; domain: DomainWithMetrics }> = [];
                if (domainMode === "date") {
                  for (const date of compareDates) {
                    const cached = compCache[`${domain.domainId}|${date}`];
                    const cd = cached?.domains.find((d) => d.domainId === domain.domainId);
                    if (cd) compDomains.push({ label: date, domain: cd });
                  }
                } else if (domainMode === "athlete" && compareReport) {
                  const cd = compareReport.domains.find((d) => d.domainId === domain.domainId);
                  if (cd) compDomains.push({ label: compareReport.athlete.name, domain: cd });
                }

                const compareModeButtons = (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{
                        fontSize: "13px",
                        padding: "7px 16px",
                        borderRadius: 6,
                        border: `1px solid ${domainMode === "date" ? "var(--accent)" : "var(--border)"}`,
                        background: domainMode === "date" ? "var(--accent-muted)" : "transparent",
                        color: domainMode === "date" ? "var(--accent)" : "var(--text-secondary)",
                        fontWeight: 500,
                      }}
                      onClick={() => toggleDomainMode("date")}
                    >
                      Compare Sessions
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{
                        fontSize: "13px",
                        padding: "7px 16px",
                        borderRadius: 6,
                        border: `1px solid ${domainMode === "athlete" ? "var(--accent)" : "var(--border)"}`,
                        background: domainMode === "athlete" ? "var(--accent-muted)" : "transparent",
                        color: domainMode === "athlete" ? "var(--accent)" : "var(--text-secondary)",
                        fontWeight: 500,
                      }}
                      onClick={() => toggleDomainMode("athlete")}
                    >
                      Compare Other Athletes
                    </button>
                    {domainMode === "athlete" && (
                      <>
                        <Select
                          value={compareUuid ?? ""}
                          onChange={(value) => setCompareUuid(value || null)}
                          disabled={loadingCompare}
                          data={[
                            { value: "", label: "— None —" },
                            ...searchResults
                              .filter((a) => a.athlete_uuid !== currentUuid)
                              .map((a) => ({ value: a.athlete_uuid, label: a.name })),
                          ]}
                          clearable
                          w={200}
                          size="xs"
                        />
                        {loadingCompare && <Text size="sm" c="dimmed">Loading…</Text>}
                      </>
                    )}
                  </div>
                );

                if (domain.domainId === "athleticScreen") return (
                  <AthleticScreenDomain
                    domain={domain}
                    domainMode={domainMode}
                    compareDates={compareDates}
                    compDomains={compDomains}
                    availForDomain={availForDomain}
                    primaryDate={primaryDate}
                    remainingDates={remainingDates}
                    compLoadingKeys={compLoadingKeys}
                    loadingDates={loadingDates}
                    compareModeButtons={compareModeButtons}
                    athleticScreenSubIndex={athleticScreenSubIndex}
                    setAthleticScreenSubIndex={setAthleticScreenSubIndex}
                    expandedAthleticInfo={expandedAthleticInfo}
                    setExpandedAthleticInfo={setExpandedAthleticInfo}
                    addCompareDate={addCompareDate}
                    removeCompareDate={removeCompareDate}
                  />
                );

                if (domain.domainId === "proteus") return (
                  <ProteusDomain
                    domain={domain}
                    domainMode={domainMode}
                    compareDates={compareDates}
                    compDomains={compDomains}
                    availForDomain={availForDomain}
                    primaryDate={primaryDate}
                    remainingDates={remainingDates}
                    compLoadingKeys={compLoadingKeys}
                    loadingDates={loadingDates}
                    compareModeButtons={compareModeButtons}
                    addCompareDate={addCompareDate}
                    removeCompareDate={removeCompareDate}
                  />
                );

                return (
                  <GenericDomain
                    domain={domain}
                    domainMode={domainMode}
                    viewMode={viewMode}
                    compareDates={compareDates}
                    compDomains={compDomains}
                    series={series}
                    availForDomain={availForDomain}
                    primaryDate={primaryDate}
                    remainingDates={remainingDates}
                    compLoadingKeys={compLoadingKeys}
                    loadingDates={loadingDates}
                    timelineKeys={timelineKeys}
                    timelineDates={timelineDates}
                    compareModeButtons={compareModeButtons}
                    expandedMobilityGroups={expandedMobilityGroups}
                    setExpandedMobilityGroups={setExpandedMobilityGroups}
                    addCompareDate={addCompareDate}
                    removeCompareDate={removeCompareDate}
                    setDomainViewMode={setDomainViewMode}
                    getDomainForDate={getDomainForDate}
                  />
                );
              })()}
            </>
          )}

          <Text size="sm" c="dimmed" mt="md">
            <Link href="/dashboard">Back to dashboard</Link>
          </Text>
        </>
      )}
    </Stack>
  );
}

export function AthleteTrackingContent() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <AthleteTrackingContentInner />
    </Suspense>
  );
}
