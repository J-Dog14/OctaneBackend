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
import MetricRadarChart, { type RadarDataSeries } from "./MetricRadarChart";
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

                if (domain.domainId === "athleticScreen") {
                  const ATHLETIC_SCREEN_MOVEMENT_ORDER = ["DJ", "PPU", "CMJ", "SLV"] as const;
                  const ATHLETIC_SCREEN_VARIABLE_ORDER = [
                    "JH", "Peak Power", "Work (AUC)", "Kurtosis", "Max RPD", "Time to Max RPD", "RSI", "CT",
                  ] as const;
                  const ATHLETIC_SCREEN_VARIABLE_DESCRIPTIONS: Record<string, string> = {
                    JH: "Jump height; higher generally indicates better explosive output.",
                    "Peak Power": "Peak power; maximum power generated during the movement.",
                    "Work (AUC)": "Total mechanical energy produced during the movement.",
                    Kurtosis: "Shape descriptor of the power-time curve.",
                    "Max RPD": "Peak slope of the power-time curve from 10–90% of peak power.",
                    "Time to Max RPD": "Time elapsed from movement start to peak rate of power development.",
                    RSI: "Reactive Strength Index; jump outcome relative to contact time.",
                    CT: "Contact time during the drop jump.",
                  };

                  type AthleticVariableDetail = {
                    formula: string;
                    what: string;
                    benchmarks: string;
                    characterizes: string;
                  };
                  const ATHLETIC_SCREEN_VARIABLE_DETAIL: Partial<Record<string, AthleticVariableDetail>> = {
                    "Work (AUC)": {
                      formula: "Time integral of the power curve (Joules) — area under the power-time trace.",
                      what: "Captures both how much power was produced and how long it was sustained. Two athletes can share the same peak power but differ wildly in AUC if one sustains output and the other spikes then drops. Higher AUC means more total mechanical energy delivered to the system.",
                      benchmarks: "Values are movement-specific and not directly comparable across DJ, CMJ, PPU, and SLV. Rising AUC across sessions for the same movement indicates improved power endurance or better force application timing. In the DJ the contact phase is brief so AUC reflects explosive efficiency under constraint; in the CMJ the longer propulsion window typically yields higher AUC.",
                      characterizes: "Total energy output quality — the interaction of amplitude and duration. Pair with Max RPD: high RPD + high AUC = explosive and sustained; high RPD + low AUC = explosive but brief. Low AUC relative to PP suggests the athlete peaks early and decays quickly.",
                    },
                    Kurtosis: {
                      formula: "Fourth standardized moment of the power-time distribution. Measures the 'peakedness' vs flatness of the curve.",
                      what: "High kurtosis → the power curve has a sharp, narrow spike; power is concentrated at one specific moment. Low kurtosis → power is spread more evenly across the movement. Neither is inherently better — it depends on the movement and what you are training.",
                      benchmarks: "DJ and SLV tend to naturally produce higher kurtosis due to the short, reactive nature of the effort. CMJ typically has lower kurtosis as the longer amortization phase spreads power across more time. PPU kurtosis reflects upper-body explosive strategy. Sudden unexplained drops in kurtosis for a given movement may indicate fatigue-driven changes in motor strategy.",
                      characterizes: "The shape and concentration of force application. When paired with Max RPD it reveals whether explosive capacity is channeled into a single high-intensity spike (DJ/sprint-like) or distributed across a broader propulsion window (CMJ/strength-dominant). Useful for profiling sport-specific force strategies and detecting session-to-session motor pattern shifts.",
                    },
                    "Max RPD": {
                      formula: "Peak slope of the power-time curve, calculated between 10% and 90% of peak power (W/s).",
                      what: "Measures how fast the athlete ramps up power — the steepness of the rising edge of the power curve. It is primarily a neural quality: motor unit recruitment speed, synchronization, and rate coding. High peak power with low RPD means the athlete gets there eventually but too slowly for reactive sport demands.",
                      benchmarks: "RPD values differ substantially across movements — DJ and SLV produce the steepest ramps due to the reactive constraint; CMJ allows a slower build; PPU reflects upper-body neural drive. Always compare within the same movement across sessions. Consistent improvement in DJ Max RPD is one of the strongest indicators of plyometric development.",
                      characterizes: "Neural drive and explosive onset. RPD ≈ 'How fast can you turn power on?' Directly relevant to DJ and SLV where the ground contact window leaves no time for a slow ramp. An athlete can have elite PP and AUC but underperform in reactive tasks if RPD is low.",
                    },
                    "Time to Max RPD": {
                      formula: "Milliseconds from movement initiation to the instant of peak rate of power development.",
                      what: "Shorter time means the explosive peak arrives sooner. This reflects how quickly the nervous system can coordinate peak motor unit recruitment. It is particularly meaningful in the DJ and SLV where the entire contact phase may last only 150–250 ms.",
                      benchmarks: "In the DJ, Time to Max RPD must be very short to occur within the contact window — values that exceed contact time indicate the athlete is not producing their explosive peak on the ground at all. In CMJ and PPU, somewhat longer times are expected and appropriate. Shorter Time to Max RPD combined with high Max RPD = elite explosive profile.",
                      characterizes: "The accessibility and immediacy of explosive output. Complements Max RPD: the RPD value is the ceiling, Time to Max RPD is how fast you reach it. An athlete with high RPD but long Time to Max RPD has the capacity but cannot access it reactively — a gap that shows up in DJ performance and sport-specific acceleration tasks.",
                    },
                    RSI: {
                      formula: "RSI = Jump Height ÷ Contact Time. Reported on a 0–5 scale (values are multiplied by 2 to amplify resolution).",
                      what: "Combines jump outcome with ground contact efficiency into a single ratio. Quantifies the stretch-shortening cycle (SSC) — the ability to store elastic energy on impact and release it as propulsive force. Higher RSI means more output achieved in less time on the ground. Because values are scaled ×2, the displayed number is twice the raw ratio.",
                      benchmarks: "On this scaled 0–5 system: ~3.0 represents a solid competitive athlete baseline; values above 4.0 are typically elite-level reactive capacity; values below 2.0 may indicate SSC deficits or elevated fatigue. RSI applies primarily to DJ and SLV where a reactive constraint is present. CMJ and PPU RSI should be interpreted with caution as the movement is not reactive.",
                      characterizes: "Tendon stiffness, elastic energy utilization, and reactive neuromuscular efficiency. RSI is distinct from peak power — an athlete can be very powerful (high PP, high AUC) but have poor RSI if they are slow off the ground. It is the most direct measure of plyometric and reactive capacity in this screen, and often the most sensitive to fatigue.",
                    },
                  };
                  const ATHLETIC_SCREEN_TABLE_CATEGORY_ORDER = [
                    "DJ", "CMJ", "PPU", "SLV_Left", "SLV_Right",
                  ] as const;
                  const ATHLETIC_SCREEN_CATEGORY_LABELS: Record<string, string> = {
                    CMJ: "CMJ", DJ: "DJ", PPU: "PPU", SLV_Left: "SLV Left", SLV_Right: "SLV Right",
                  };
                  const movements = ATHLETIC_SCREEN_MOVEMENT_ORDER.filter((mov) =>
                    domain.metrics.some(
                      (m) => m.category === mov || (mov === "SLV" && m.category.startsWith("SLV_"))
                    )
                  );
                  const currentMovement = movements[athleticScreenSubIndex] ?? movements[0];
                  const currentMovementIndex = Math.max(0, movements.indexOf(currentMovement));
                  const isSlv = currentMovement === "SLV";
                  const movementMetrics = isSlv
                    ? domain.metrics.filter((m) => m.category.startsWith("SLV_"))
                    : domain.metrics.filter((m) => m.category === currentMovement);
                  const slvLeft = movementMetrics.filter((m) => m.category === "SLV_Left");
                  const slvRight = movementMetrics.filter((m) => m.category === "SLV_Right");
                  const metricByCategoryAndName = new Map<string, MetricWithPercentile>();
                  for (const metric of domain.metrics) {
                    metricByCategoryAndName.set(`${metric.category}|${metric.name}`, metric);
                  }

                  // Build radar series (primary + comparison dates)
                  const athleticRadarSeries: RadarDataSeries[] = [
                    {
                      name: domain.sessionDate ?? "Latest",
                      data: metricsToRadarData(movementMetrics, domain.domainId),
                      color: SERIES_COLORS[0]!,
                    },
                    ...compDomains.map(({ label, domain: cd }, i) => {
                      const cdMovementMetrics = isSlv
                        ? cd.metrics.filter((m) => m.category.startsWith("SLV_"))
                        : cd.metrics.filter((m) => m.category === currentMovement);
                      return {
                        name: label,
                        data: metricsToRadarData(cdMovementMetrics, domain.domainId),
                        color: SERIES_COLORS[i + 1]!,
                      };
                    }),
                  ];

                  // Build comparison metric lookup maps for table
                  const compMetricMaps = compDomains.map(({ label, domain: cd }) => {
                    const map = new Map<string, MetricWithPercentile>();
                    for (const m of cd.metrics) map.set(`${m.category}|${m.name}`, m);
                    return { label, map };
                  });

                  return (
                    <>
                      {compareModeButtons}
                      {/* Session comparison panel */}
                      {domainMode === "date" && availForDomain.length > 1 && (
                        <div className="card" style={{ marginBottom: "1rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Sessions:</span>
                            <span style={{ fontSize: "13px", padding: "3px 10px", borderRadius: 6, border: "1px solid var(--accent)", background: "var(--accent-muted)", color: "var(--accent)" }}>
                              {primaryDate ?? "Latest"} (primary)
                            </span>
                            {compareDates.map((date) => {
                              const key = `${domain.domainId}|${date}`;
                              const isLoading = compLoadingKeys.includes(key);
                              return (
                                <span key={date} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "13px", padding: "3px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-tertiary)" }}>
                                  {isLoading ? `${date} (loading…)` : date}
                                  <button type="button" className="btn-ghost" style={{ padding: "0 3px", fontSize: "12px" }} onClick={() => removeCompareDate(domain.domainId, date)} aria-label={`Remove ${date}`}>×</button>
                                </span>
                              );
                            })}
                            {compareDates.length < 3 && remainingDates.length > 0 && (
                              <Select
                                value={null}
                                placeholder="+ Add date…"
                                data={remainingDates.map((d) => ({ value: d, label: d }))}
                                onChange={(val) => { if (val) addCompareDate(domain.domainId, val); }}
                                w={150}
                                size="xs"
                              />
                            )}
                          </div>
                          {loadingDates && availForDomain.length === 0 && (
                            <p className="text-muted" style={{ margin: "0.5rem 0 0", fontSize: "0.8rem" }}>Loading available dates…</p>
                          )}
                        </div>
                      )}
                      <div style={{ textAlign: "center", marginBottom: "0.4rem" }}>
                        <div style={{ fontSize: "0.98rem", fontWeight: 600 }}>{currentMovement}</div>
                        <div className="text-muted" style={{ fontSize: "0.78rem" }}>
                          {movements.length > 0 ? `${currentMovementIndex + 1}/${movements.length}` : "0/0"}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "auto minmax(0, 1fr) auto",
                          alignItems: "center",
                          gap: "0.6rem",
                          marginBottom: "1rem",
                        }}
                      >
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ padding: "10px 12px", minWidth: 44, fontSize: "1.05rem", fontWeight: 700 }}
                          onClick={() =>
                            setAthleticScreenSubIndex((prev) =>
                              movements.length === 0 ? 0 : (prev - 1 + movements.length) % movements.length
                            )
                          }
                          disabled={movements.length <= 1}
                          aria-label="Previous movement"
                        >
                          ←
                        </button>
                        {isSlv ? (
                          <MetricRadarChart
                            title={`SLV${domain.sessionDate ? ` (${domain.sessionDate})` : ""} – percentiles`}
                            dataSeries={[
                              { name: "SLV Left", data: metricsToRadarData(slvLeft, domain.domainId), color: SERIES_COLORS[0]! },
                              { name: "SLV Right", data: metricsToRadarData(slvRight, domain.domainId), color: "#ef4444" },
                            ]}
                          />
                        ) : (
                          <MetricRadarChart
                            title={`${currentMovement}${domain.sessionDate ? ` (${domain.sessionDate})` : ""} – percentiles`}
                            data={athleticRadarSeries.length === 1 ? athleticRadarSeries[0]!.data : undefined}
                            dataSeries={athleticRadarSeries.length > 1 ? athleticRadarSeries : undefined}
                          />
                        )}
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ padding: "10px 12px", minWidth: 44, fontSize: "1.05rem", fontWeight: 700 }}
                          onClick={() =>
                            setAthleticScreenSubIndex((prev) =>
                              movements.length === 0 ? 0 : (prev + 1) % movements.length
                            )
                          }
                          disabled={movements.length <= 1}
                          aria-label="Next movement"
                        >
                          →
                        </button>
                      </div>
                      <div className="card">
                        <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>
                          Metrics{domain.sessionDate ? ` · ${domain.sessionDate}` : ""}
                        </h3>
                        <table style={{ borderCollapse: "collapse" }}>
                          <thead>
                            <tr>
                              <th>Variable</th>
                              {ATHLETIC_SCREEN_TABLE_CATEGORY_ORDER.map((cat) => (
                                <th key={cat}>{ATHLETIC_SCREEN_CATEGORY_LABELS[cat]}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {ATHLETIC_SCREEN_VARIABLE_ORDER.map((variableName, variableIdx) => {
                              const hasAny = ATHLETIC_SCREEN_TABLE_CATEGORY_ORDER.some((category) =>
                                metricByCategoryAndName.has(`${category}|${variableName}`)
                              );
                              if (!hasAny) return null;
                              return (
                                <Fragment key={`athletic-var-${variableName}`}>
                                  {variableIdx > 0 ? (
                                    <tr>
                                      <td colSpan={6} style={{ padding: "0.45rem 0 0.35rem", borderBottom: "none" }}>
                                        <div style={{ borderTop: "1px solid var(--border)" }} />
                                      </td>
                                    </tr>
                                  ) : null}
                                  <tr>
                                    <td style={{ borderBottom: "none", padding: "0.2rem 0.35rem 0.55rem 0", maxWidth: 220 }}>
                                      <div style={{ fontWeight: 600, marginBottom: "0.2rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                        {variableName}
                                        {ATHLETIC_SCREEN_VARIABLE_DETAIL[variableName] && (
                                          <Tooltip label={`More info about ${variableName}`} withArrow position="top">
                                            <ActionIcon
                                              variant={expandedAthleticInfo === variableName ? "light" : "subtle"}
                                              color={expandedAthleticInfo === variableName ? "octaneBlue" : "gray"}
                                              radius="xl"
                                              size={16}
                                              onClick={() => setExpandedAthleticInfo((prev) => prev === variableName ? null : variableName)}
                                              aria-label={`More info about ${variableName}`}
                                              style={{ flexShrink: 0, fontSize: "10px" }}
                                            >
                                              i
                                            </ActionIcon>
                                          </Tooltip>
                                        )}
                                      </div>
                                      <div className="text-muted" style={{ fontSize: "0.8rem" }}>
                                        {ATHLETIC_SCREEN_VARIABLE_DESCRIPTIONS[variableName]}
                                      </div>
                                      {expandedAthleticInfo === variableName && ATHLETIC_SCREEN_VARIABLE_DETAIL[variableName] && (() => {
                                        const detail = ATHLETIC_SCREEN_VARIABLE_DETAIL[variableName]!;
                                        return (
                                          <div style={{
                                            marginTop: "0.6rem",
                                            padding: "0.6rem 0.75rem",
                                            borderRadius: 6,
                                            background: "rgba(255,255,255,0.04)",
                                            border: "1px solid var(--border)",
                                            fontSize: "0.76rem",
                                            lineHeight: 1.5,
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: "0.5rem",
                                          }}>
                                            <div>
                                              <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>Formula</div>
                                              <div style={{ color: "rgba(255,255,255,0.7)" }}>{detail.formula}</div>
                                            </div>
                                            <div>
                                              <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>What the number means</div>
                                              <div style={{ color: "rgba(255,255,255,0.7)" }}>{detail.what}</div>
                                            </div>
                                            <div>
                                              <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>Benchmarks</div>
                                              <div style={{ color: "rgba(255,255,255,0.7)" }}>{detail.benchmarks}</div>
                                            </div>
                                            <div>
                                              <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>Characterizes</div>
                                              <div style={{ color: "rgba(255,255,255,0.7)" }}>{detail.characterizes}</div>
                                            </div>
                                          </div>
                                        );
                                      })()}
                                    </td>
                                    {ATHLETIC_SCREEN_TABLE_CATEGORY_ORDER.map((category) => {
                                      const metric = metricByCategoryAndName.get(`${category}|${variableName}`) ?? null;
                                      return (
                                        <td key={`athletic-cell-${variableName}-${category}`} style={{ verticalAlign: "top" }}>
                                          {metric ? (
                                            <>
                                              <div>
                                                {(() => {
                                                  const { valuePart, unitPart } = formatMetricValueParts(metric);
                                                  return valuePart === "—" ? "" : (<><strong>{valuePart}</strong>{unitPart}</>);
                                                })()}
                                              </div>
                                              <div
                                                className={metric.percentile == null ? "text-muted" : undefined}
                                                style={{
                                                  marginTop: "0.2rem",
                                                  fontSize: "0.78rem",
                                                  ...(metric.percentile != null ? (getPercentileStyle(metric.percentile) ?? {}) : {}),
                                                }}
                                              >
                                                {metric.percentile != null ? `${Math.round(metric.percentile)}th %ile` : ""}
                                              </div>
                                              {compMetricMaps.map(({ label, map }) => {
                                                const cm = map.get(`${category}|${variableName}`);
                                                if (!cm) return null;
                                                const { valuePart, unitPart } = formatMetricValueParts(cm);
                                                return (
                                                  <div key={label} style={{ marginTop: "0.4rem", borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: "0.3rem" }}>
                                                    <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.38)", marginBottom: "0.1rem" }}>{label}</div>
                                                    <span style={{ fontSize: "0.88rem", color: "rgba(255,255,255,0.5)" }}>
                                                      {valuePart !== "—" ? `${valuePart}${unitPart}` : "—"}
                                                    </span>
                                                  </div>
                                                );
                                              })}
                                            </>
                                          ) : (
                                            ""
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  );
                }

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
                  <>
                    {compareModeButtons}
                    {/* Session comparison panel */}
                    {domainMode === "date" && availForDomain.length > 1 && (
                      <div className="card" style={{ marginBottom: "1rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Sessions:</span>
                          <span
                            style={{
                              fontSize: "13px",
                              padding: "3px 10px",
                              borderRadius: 6,
                              border: "1px solid var(--accent)",
                              background: "var(--accent-muted)",
                              color: "var(--accent)",
                            }}
                          >
                            {primaryDate ?? "Latest"} (primary)
                          </span>
                          {compareDates.map((date) => {
                            const key = `${domain.domainId}|${date}`;
                            const isLoading = compLoadingKeys.includes(key);
                            return (
                              <span
                                key={date}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.35rem",
                                  fontSize: "13px",
                                  padding: "3px 10px",
                                  borderRadius: 6,
                                  border: "1px solid var(--border)",
                                  background: "var(--bg-tertiary)",
                                }}
                              >
                                {isLoading ? `${date} (loading…)` : date}
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  style={{ padding: "0 3px", fontSize: "12px" }}
                                  onClick={() => removeCompareDate(domain.domainId, date)}
                                  aria-label={`Remove ${date}`}
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                          {compareDates.length < 3 && remainingDates.length > 0 && (
                            <select
                              value=""
                              onChange={(e) => {
                                if (e.target.value) addCompareDate(domain.domainId, e.target.value);
                              }}
                              style={{
                                padding: "3px 8px",
                                borderRadius: 6,
                                border: "1px solid var(--border)",
                                background: "var(--bg-tertiary)",
                                color: "var(--text-secondary)",
                                fontSize: "13px",
                              }}
                            >
                              <option value="">+ Add date…</option>
                              {remainingDates.map((d) => (
                                <option key={d} value={d}>{d}</option>
                              ))}
                            </select>
                          )}
                          {/* View mode toggle: Radar / Timeline */}
                          {timelineKeys.length > 0 && (
                            <div style={{ marginLeft: "auto", display: "flex", gap: "0.35rem" }}>
                              <button
                                type="button"
                                className="btn-ghost"
                                style={{
                                  fontSize: "12px",
                                  padding: "3px 10px",
                                  borderRadius: 6,
                                  border: `1px solid ${viewMode === "compare" ? "var(--accent)" : "var(--border)"}`,
                                  background: viewMode === "compare" ? "var(--accent-muted)" : "var(--bg-tertiary)",
                                  color: viewMode === "compare" ? "var(--accent)" : "var(--text-secondary)",
                                }}
                                onClick={() => setDomainViewMode((prev) => ({ ...prev, [domain.domainId]: "compare" }))}
                              >
                                Radar
                              </button>
                              <button
                                type="button"
                                className="btn-ghost"
                                style={{
                                  fontSize: "12px",
                                  padding: "3px 10px",
                                  borderRadius: 6,
                                  border: `1px solid ${viewMode === "timeline" ? "var(--accent)" : "var(--border)"}`,
                                  background: viewMode === "timeline" ? "var(--accent-muted)" : "var(--bg-tertiary)",
                                  color: viewMode === "timeline" ? "var(--accent)" : "var(--text-secondary)",
                                }}
                                onClick={() => setDomainViewMode((prev) => ({ ...prev, [domain.domainId]: "timeline" }))}
                              >
                                Timeline
                              </button>
                            </div>
                          )}
                        </div>
                        {loadingDates && availForDomain.length === 0 && (
                          <p className="text-muted" style={{ margin: "0.5rem 0 0", fontSize: "0.8rem" }}>Loading available dates…</p>
                        )}
                      </div>
                    )}

                    {/* Timeline view */}
                    {viewMode === "timeline" && timelineKeys.length > 0 && timelineDates.length > 0 ? (
                      <div className="card" style={{ marginBottom: "1rem" }}>
                        <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Timeline</h3>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                            gap: "1.25rem",
                          }}
                        >
                          {timelineKeys.map((key) => {
                            const [cat, name] = key.split("|") as [string, string];
                            const label = formatMetricDisplayName(name, cat, domain.domainId);
                            // Build chart data sorted chronologically (oldest → newest)
                            const chartDates = [...timelineDates].sort((a, b) => a.localeCompare(b));
                            const chartData = chartDates.map((date) => {
                              const d = getDomainForDate(date);
                              const raw = getMetricValueFromDomain(d, key);
                              const num = raw === "—" ? null : parseFloat(raw);
                              return { date, value: Number.isFinite(num) ? num : null };
                            });
                            // Extract unit from primary domain metric
                            const sampleMetric = getMetricByKey(domain.metrics, key);
                            const unit = sampleMetric?.valueUnit && sampleMetric.valueUnit !== "NONE" && sampleMetric.valueUnit !== "UNITLESS"
                              ? sampleMetric.valueUnit.toLowerCase().replace(/_/g, " ")
                              : undefined;
                            return (
                              <MetricLineChart
                                key={key}
                                title={label}
                                data={chartData}
                                unit={unit}
                              />
                            );
                          })}
                        </div>
                        {timelineDates.some((d) => d !== primaryDate && !compCache[`${domain.domainId}|${d}`]) && (
                          <p className="text-muted" style={{ margin: "0.75rem 0 0", fontSize: "0.8rem" }}>
                            Add comparison dates above to populate the timeline.
                          </p>
                        )}
                      </div>
                    ) : (
                      /* Radar / compare view */
                      <div style={{ marginBottom: "1rem" }}>
                        <MetricRadarChart
                          title={
                            domain.sessionDate
                              ? `${domain.label} (${domain.sessionDate}) – percentiles`
                              : `${domain.label} – percentiles`
                          }
                          data={series.length === 1 ? series[0]!.data : undefined}
                          dataSeries={series.length > 1 ? series : undefined}
                        />
                      </div>
                    )}

                    {/* Domain-specific detail tables */}
                    {domain.domainId === "pitching" ? (
                      <>
                        {PITCHING_TABLE_SECTIONS.map((section) => {
                          const cells = buildPitchingDisplayCells(domain.metrics, section.items);
                          const compCellSets = compDomains.map(({ label, domain: cd }) => ({
                            label,
                            cells: buildPitchingDisplayCells(cd.metrics, section.items),
                          }));

                          // Kinematic sequence peak order: rank PELVIS, TORSO, ARM, HAND by their timing value
                          const peakOrderRanks: Record<string, number> = {};
                          if (section.id === "kinematic-sequence") {
                            const timingKeys = [
                              { key: "KINEMATIC_SEQUENCE|PELVIS", timeKey: "KINEMATIC_SEQUENCE|PELVIS_TIME" },
                              { key: "KINEMATIC_SEQUENCE|TORSO", timeKey: "KINEMATIC_SEQUENCE|TORSO_TIME" },
                              { key: "KINEMATIC_SEQUENCE|ARM", timeKey: "KINEMATIC_SEQUENCE|ARM_TIME" },
                              { key: "KINEMATIC_SEQUENCE|HAND", timeKey: "KINEMATIC_SEQUENCE|HAND_TIME" },
                            ];
                            const times = timingKeys.map(({ key, timeKey }) => {
                              const m = domain.metrics.find(
                                (met) => met.category && `${met.category}|${met.name}` === timeKey
                              );
                              return { key, time: m?.value ?? null };
                            });
                            const withTime = times.filter((t) => t.time != null);
                            withTime.sort((a, b) => (a.time as number) - (b.time as number));
                            withTime.forEach((t, i) => { peakOrderRanks[t.key] = i + 1; });
                          }

                          // Build insight texts for this section
                          const insights: Array<{ label: string; text: string }> = [];
                          if (section.insightKeys) {
                            for (const iKey of section.insightKeys) {
                              const m = domain.metrics.find(
                                (met) => met.category && `${met.category}|${met.name}` === iKey
                              );
                              const text = getMetricInsight(iKey, m?.value ?? null);
                              if (text) {
                                const cellForKey = cells.find((c) => c.key === iKey);
                                insights.push({ label: cellForKey?.label ?? iKey, text });
                              }
                            }
                          }

                          {/* Use helper (not JSX truthiness) to decide layout */}
                          const hasDiagram = hasPitchingDiagram(section.id);

                          return (
                            <div key={section.id} className="card" style={{ marginBottom: "1rem" }}>
                              {/* Section header: diagram (if present) + title/description */}
                              {hasDiagram ? (
                                <div className="diagram-header">
                                  <PitchingDiagram sectionId={section.id} />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    {section.title ? (
                                      <h3 style={{ margin: "0 0 0.35rem", fontSize: "1rem" }}>{section.title}</h3>
                                    ) : null}
                                    <p
                                      className="text-muted"
                                      style={{ margin: 0, fontSize: "0.82rem", lineHeight: 1.45 }}
                                    >
                                      {section.description}
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {section.title ? (
                                    <h3 style={{ margin: "0 0 0.35rem", fontSize: "1rem" }}>{section.title}</h3>
                                  ) : null}
                                  <p
                                    className="text-muted"
                                    style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", lineHeight: 1.45 }}
                                  >
                                    {section.description}
                                  </p>
                                </>
                              )}
                              <div className="table-scroll-wrapper">
                              <table>
                                <thead>
                                  <tr>
                                    {cells.map((cell) => (
                                      <th key={`${section.id}-${cell.key}`}>{cell.label}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    {cells.map((cell, cellIdx) => (
                                      <td key={`${section.id}-${cell.key}-value`}>
                                        {cell.valuePart === "—" ? "—" : (() => {
                                          const isGainOrLoss = cell.key.endsWith("|GAIN_OR_LOSS");
                                          const valueStyle: React.CSSProperties | undefined =
                                            isGainOrLoss
                                              ? cell.valuePart === "GAIN"
                                                ? { color: "#16a34a" }
                                                : cell.valuePart === "LOSS"
                                                  ? { color: "var(--accent-secondary)" }
                                                  : undefined
                                              : cell.key === "DERIVED|ARM_TIMING_FLAG"
                                                ? cell.valuePart === "ON_TIME"
                                                  ? { color: "#16a34a" }
                                                  : cell.valuePart === "EARLY" || cell.valuePart === "LATE"
                                                    ? { color: "var(--accent-secondary)" }
                                                    : undefined
                                                : cell.percentile != null
                                                  ? (getPercentileStyle(cell.percentile) ?? undefined)
                                                  : undefined;
                                          return (
                                            <>
                                              <strong style={valueStyle}>{cell.valuePart}</strong>
                                              {cell.unitPart && (
                                                <span style={valueStyle}>{cell.unitPart}</span>
                                              )}
                                            </>
                                          );
                                        })()}
                                        {!cell.key.endsWith("|GAIN_OR_LOSS") && cell.key !== "DERIVED|ARM_TIMING_FLAG" && cell.valuePart !== "N/A" && (
                                          <div
                                            className={cell.percentile == null ? "text-muted" : undefined}
                                            style={{
                                              marginTop: "0.2rem",
                                              fontSize: "0.78rem",
                                              ...(cell.percentile != null ? (getPercentileStyle(cell.percentile) ?? {}) : {}),
                                            }}
                                          >
                                            {cell.percentile != null ? `${Math.round(cell.percentile)}th %ile` : "—"}
                                          </div>
                                        )}
                                        {compCellSets.map(({ label, cells: ccs }) => {
                                          const cc = ccs[cellIdx];
                                          return (
                                            <div
                                              key={label}
                                              style={{
                                                marginTop: "0.4rem",
                                                borderTop: "1px solid rgba(255,255,255,0.07)",
                                                paddingTop: "0.3rem",
                                              }}
                                            >
                                              <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.38)", marginBottom: "0.1rem" }}>
                                                {label}
                                              </div>
                                              <span style={{ fontSize: "0.88rem", color: "rgba(255,255,255,0.5)" }}>
                                                {cc && cc.valuePart !== "—" ? `${cc.valuePart}${cc.unitPart}` : "—"}
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </td>
                                    ))}
                                  </tr>
                                  {/* Kinematic sequence peak order row */}
                                  {section.id === "kinematic-sequence" && Object.keys(peakOrderRanks).length > 0 && (
                                    <tr>
                                      {cells.map((cell) => (
                                        <td key={`${section.id}-${cell.key}-peak-order`} style={{ fontSize: "0.82rem" }}>
                                          {peakOrderRanks[cell.key] != null ? (
                                            <span style={{ color: "rgba(255,255,255,0.55)" }}>
                                              Peak Order: <strong style={{ color: "var(--text-primary)" }}>#{peakOrderRanks[cell.key]}</strong>
                                            </span>
                                          ) : "—"}
                                        </td>
                                      ))}
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                              </div>{/* /table-scroll-wrapper */}
                              {/* Section insight panel */}
                              {insights.length > 0 && (
                                <div
                                  style={{
                                    marginTop: "0.75rem",
                                    padding: "0.6rem 0.75rem",
                                    background: "rgba(255,255,255,0.04)",
                                    borderRadius: "6px",
                                    borderLeft: "3px solid rgba(255,255,255,0.15)",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "0.4rem",
                                  }}
                                >
                                  {insights.map(({ label, text }) => (
                                    <div key={label} style={{ fontSize: "0.8rem", lineHeight: 1.5 }}>
                                      <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.65)", marginRight: "0.4rem" }}>{label}:</span>
                                      <span className="text-muted">{text}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </>
                    ) : domain.domainId === "hitting" ? (
                      <>
                        {HITTING_TABLE_SECTIONS.map((section) => {
                          const cells = buildHittingDisplayCells(domain.metrics, section.items);
                          const compCellSets = compDomains.map(({ label, domain: cd }) => ({
                            label,
                            cells: buildHittingDisplayCells(cd.metrics, section.items),
                          }));
                          return (
                            <div key={section.id} className="card" style={{ marginBottom: "1rem" }}>
                              <h3 style={{ margin: "0 0 0.35rem", fontSize: "1rem" }}>{section.title}</h3>
                              <p
                                className="text-muted"
                                style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", lineHeight: 1.45 }}
                              >
                                {section.description}
                              </p>
                              <div className="table-scroll-wrapper">
                              <table>
                                <thead>
                                  <tr>
                                    {cells.map((cell) => (
                                      <th key={`${section.id}-${cell.key}`}>{cell.label}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    {cells.map((cell, cellIdx) => (
                                      <td key={`${section.id}-${cell.key}-value`}>
                                        {cell.valuePart === "—" ? "—" : (
                                          <>
                                            <strong>{cell.valuePart}</strong>
                                            {cell.unitPart}
                                          </>
                                        )}
                                        <div
                                          className={cell.percentile == null ? "text-muted" : undefined}
                                          style={{
                                            marginTop: "0.2rem",
                                            fontSize: "0.78rem",
                                            ...(cell.percentile != null ? (getPercentileStyle(cell.percentile) ?? {}) : {}),
                                          }}
                                        >
                                          {cell.percentile != null ? `${Math.round(cell.percentile)}th %ile` : "—"}
                                        </div>
                                        {compCellSets.map(({ label, cells: ccs }) => {
                                          const cc = ccs[cellIdx];
                                          return (
                                            <div
                                              key={label}
                                              style={{
                                                marginTop: "0.4rem",
                                                borderTop: "1px solid rgba(255,255,255,0.07)",
                                                paddingTop: "0.3rem",
                                              }}
                                            >
                                              <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.38)", marginBottom: "0.1rem" }}>
                                                {label}
                                              </div>
                                              <span style={{ fontSize: "0.88rem", color: "rgba(255,255,255,0.5)" }}>
                                                {cc && cc.valuePart !== "—" ? `${cc.valuePart}${cc.unitPart}` : "—"}
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </td>
                                    ))}
                                  </tr>
                                </tbody>
                              </table>
                              </div>{/* /table-scroll-wrapper */}
                            </div>
                          );
                        })}
                      </>
                    ) : domain.domainId === "mobility" ? (
                      <div className="card">
                        <table style={{ borderCollapse: "collapse" }}>
                          <tbody>
                            {domain.sessionDate ? (
                              <tr>
                                <td
                                  colSpan={3}
                                  className="text-muted"
                                  style={{ fontSize: "0.82rem", padding: "0.35rem 0 1.6rem", borderBottom: "none" }}
                                >
                                  Session Date: {domain.sessionDate}
                                </td>
                              </tr>
                            ) : null}
                            {buildMobilityGroupSections(domain.metrics).map((section, idx) => {
                              const scoreValue =
                                section.group.value != null && Number.isFinite(section.group.value)
                                  ? Math.round(section.group.value)
                                  : null;
                              const isShoulderMobility = section.group.category === "Shoulder Mobility";
                              const scoreText =
                                scoreValue != null
                                  ? isShoulderMobility
                                    ? `${scoreValue}°`
                                    : section.group.max != null && section.group.max > 0
                                      ? `${scoreValue}/${section.group.max}`
                                      : `${scoreValue}`
                                  : "—";
                              const percentText =
                                (section.group.category === "Grip Strength" || isShoulderMobility) &&
                                  section.group.percentile != null &&
                                  Number.isFinite(section.group.percentile)
                                  ? `${Math.round(section.group.percentile)}th %ile`
                                  : !isShoulderMobility &&
                                      scoreValue != null &&
                                      section.group.max != null &&
                                      section.group.max > 0
                                    ? `${Math.round((scoreValue / section.group.max) * 100)}%`
                                    : "—";
                              const isGripStrength = section.group.category === "Grip Strength";
                              const isExpanded = Boolean(expandedMobilityGroups[section.group.category]);
                              return (
                                <Fragment key={`mobility-group-${section.group.category}`}>
                                  <tr>
                                    <td colSpan={3} style={{ padding: idx === 0 ? "0 0 0.55rem" : "0.9rem 0 0.55rem", borderBottom: "none" }}>
                                      <div style={{ borderTop: "1px solid var(--border)" }} />
                                    </td>
                                  </tr>
                                  <tr>
                                    <td
                                      style={{
                                        fontSize: "1.08rem",
                                        fontWeight: 700,
                                        padding: "0.55rem 2.5rem 0.4rem 2.5rem",
                                        borderBottom: "none",
                                      }}
                                    >
                                      <div style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem" }}>
                                        <span>{section.group.mobilityDisplayLabel ?? section.group.category}</span>
                                        {section.components.length > 0 ? (
                                          <button
                                            type="button"
                                            className="btn-ghost"
                                            style={{ fontSize: "0.72rem", padding: "2px 8px", lineHeight: 1.2 }}
                                            onClick={() =>
                                              setExpandedMobilityGroups((prev) => ({
                                                ...prev,
                                                [section.group.category]: !prev[section.group.category],
                                              }))
                                            }
                                          >
                                            {isExpanded ? "Hide details" : "Show details"}
                                          </button>
                                        ) : null}
                                      </div>
                                    </td>
                                    <td
                                      style={{
                                        textAlign: "center",
                                        fontSize: "1.08rem",
                                        fontWeight: 700,
                                        whiteSpace: "nowrap",
                                        padding: "0.55rem 2.5rem 0.4rem",
                                        borderBottom: "none",
                                      }}
                                    >
                                      {scoreText}
                                    </td>
                                    <td
                                      style={{
                                        textAlign: "right",
                                        fontSize: "1.08rem",
                                        fontWeight: 700,
                                        whiteSpace: "nowrap",
                                        padding: "0.55rem 2.5rem 0.4rem",
                                        borderBottom: "none",
                                      }}
                                    >
                                      {percentText}
                                    </td>
                                  </tr>
                                  {section.components.length > 0 && isExpanded ? (
                                    <tr>
                                      <td colSpan={3} style={{ padding: "0.15rem 0 0.95rem", borderBottom: "none" }}>
                                        <div
                                          style={{
                                            display: "grid",
                                            gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))",
                                            columnGap: "0.75rem",
                                            rowGap: "0.55rem",
                                            width: "100%",
                                          }}
                                        >
                                          {section.components.map((component) => (
                                            isShoulderRomMetric(component) ? (
                                              <div
                                                key={`mobility-comp-${section.group.category}-${component.name}`}
                                                style={{
                                                  whiteSpace: "nowrap",
                                                  border: "1px solid var(--border)",
                                                  borderRadius: 999,
                                                  background: "var(--bg-tertiary)",
                                                  padding: "6px 10px",
                                                  display: "grid",
                                                  gridTemplateColumns: "1fr auto auto",
                                                  alignItems: "center",
                                                  gap: "0.6rem",
                                                }}
                                              >
                                                <span style={{ marginRight: "0.3rem", color: "var(--text-secondary)", fontSize: "0.84rem" }}>
                                                  {formatMobilityComponentLabel(component, domain.domainId)}
                                                </span>
                                                <strong style={{ fontSize: "0.9rem", justifySelf: "center" }}>
                                                  {formatMobilityComponentValue(component)}
                                                </strong>
                                                <strong style={{ fontSize: "0.82rem" }}>
                                                  {scoreOutOfThreeFromPercentile(component.percentile)}
                                                </strong>
                                              </div>
                                            ) : (
                                              <div
                                                key={`mobility-comp-${section.group.category}-${component.name}`}
                                                style={{
                                                  whiteSpace: "nowrap",
                                                  border: "1px solid var(--border)",
                                                  borderRadius: 999,
                                                  background: "var(--bg-tertiary)",
                                                  padding: "6px 10px",
                                                  display: "flex",
                                                  alignItems: "center",
                                                  justifyContent: "space-between",
                                                  gap: "0.6rem",
                                                }}
                                              >
                                                <span style={{ marginRight: "0.3rem", color: "var(--text-secondary)", fontSize: "0.84rem" }}>
                                                  {formatMobilityComponentLabel(component, domain.domainId)}
                                                </span>
                                                <strong style={{ fontSize: "0.9rem" }}>
                                                  {isGripStrength
                                                    ? formatMobilityComponentValue({ ...component, mobilityOutOf: null })
                                                    : formatMobilityComponentValue(component)}
                                                </strong>
                                              </div>
                                            )
                                          ))}
                                        </div>
                                      </td>
                                    </tr>
                                  ) : null}
                                </Fragment>
                              );
                            })}
                            <tr>
                              <td colSpan={3} style={{ padding: "0.35rem 0 0", borderBottom: "none" }}>
                                <div style={{ borderTop: "1px solid var(--border)" }} />
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="card">
                        <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>
                          Metrics{domain.sessionDate ? ` · ${domain.sessionDate}` : ""}
                        </h3>
                        <div className="table-scroll-wrapper">
                        <table>
                          <thead>
                            <tr>
                              <th>Metric</th>
                              <th>Value</th>
                              <th>Percentile</th>
                            </tr>
                          </thead>
                          <tbody>
                            {domain.metrics.map((m, i) => (
                              <tr key={`${domain.domainId}-${i}-${m.category}-${m.name}`}>
                                <td>{formatMetricDisplayName(m.name, m.category, domain.domainId)}</td>
                                <td>
                                  {(() => {
                                    const { valuePart, unitPart } = formatMetricValueParts(m);
                                    return valuePart === "—" ? "—" : (<><strong>{valuePart}</strong>{unitPart}</>);
                                  })()}
                                </td>
                                <td>
                                  {m.percentile != null ? (
                                    <span style={getPercentileStyle(m.percentile)}>
                                      {Math.round(m.percentile)}th %ile
                                    </span>
                                  ) : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        </div>{/* /table-scroll-wrapper */}
                      </div>
                    )}
                  </>
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
