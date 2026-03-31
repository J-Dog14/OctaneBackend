"use client";

import { useCallback, useEffect, useId, useState } from "react";
import {
  Title,
  Text,
  Card,
  Group,
  Stack,
  Select,
  MultiSelect,
  Button,
  SegmentedControl,
  Badge,
  Loader,
  Alert,
  Switch,
  Tabs,
  TabsList,
  TabsTab,
  TabsPanel,
  Divider,
  Collapse,
  CloseButton,
} from "@mantine/core";
import { ScatterPlot } from "./ScatterPlot";
import { TimeSeriesPlot } from "./TimeSeriesPlot";
import { StatisticsPanel } from "./StatisticsPanel";
import type { VariableInfo } from "@/app/api/dashboard/research/variables/route";
import type { ResearchDataResponse } from "@/app/api/dashboard/research/data/route";
import type { TimeSeriesSeries } from "@/app/api/dashboard/research/timeseries/route";

// ─── Constants ────────────────────────────────────────────────────────────────

const TABLE_OPTIONS = [
  { value: "pitching",            label: "Pitching (Trials)" },
  { value: "hitting",             label: "Hitting (Trials)" },
  { value: "athletic_screen_cmj", label: "Athletic Screen — CMJ" },
  { value: "athletic_screen_dj",  label: "Athletic Screen — Drop Jump" },
  { value: "athletic_screen_slv", label: "Athletic Screen — Single Leg Vert" },
  { value: "athletic_screen_nmt", label: "Athletic Screen — Neuromuscular" },
  { value: "athletic_screen_ppu", label: "Athletic Screen — Push-up Power" },
];

const TS_TABLE_OPTIONS = [
  { value: "pitching_force",       label: "Pitching — Force Data"        },
  { value: "pitching_markers",     label: "Pitching — Marker Positions"  },
  { value: "pitching_segment_pos", label: "Pitching — Segment Positions" },
  { value: "pitching_segment_rot", label: "Pitching — Segment Rotations" },
  { value: "hitting_markers",      label: "Hitting — Marker Positions"   },
  { value: "hitting_segment_pos",  label: "Hitting — Segment Positions"  },
  { value: "hitting_segment_rot",  label: "Hitting — Segment Rotations"  },
];

const TS_TABLE_LABEL: Record<string, string> = Object.fromEntries(
  TS_TABLE_OPTIONS.map((o) => [o.value, o.label]),
);

const GROUP_OPTIONS = [
  { value: "all",         label: "All Groups" },
  { value: "pro",         label: "Pro" },
  { value: "college",     label: "College" },
  { value: "high_school", label: "High School" },
  { value: "softball",    label: "Softball" },
];

// ─── Type definitions ─────────────────────────────────────────────────────────

type AthleteOption = { value: string; label: string };

type VarSelector = {
  table: string;
  variable: string;
  group: string;
};

const DEFAULT_VAR: VarSelector = { table: "", variable: "", group: "all" };

// ─── Variable selector sub-component ─────────────────────────────────────────

function VariableSelector({
  label,
  value,
  onChange,
  variables,
  loadingVars,
}: {
  label: string;
  value: VarSelector;
  onChange: (v: VarSelector) => void;
  variables: VariableInfo[];
  loadingVars: boolean;
}) {
  // Group variables by their group field
  const selectData = Object.entries(
    variables.reduce<Record<string, Array<{ value: string; label: string }>>>((acc, v) => {
      if (!acc[v.group]) acc[v.group] = [];
      acc[v.group].push({ value: v.key, label: v.label });
      return acc;
    }, {}),
  ).map(([g, opts]) => ({ group: g, items: opts }));

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.05em" }}>{label}</Text>
      <Select
        label="Table / Movement"
        placeholder="Select a table..."
        data={TABLE_OPTIONS}
        value={value.table || null}
        onChange={(v) => onChange({ ...value, table: v ?? "", variable: "" })}
        searchable
        clearable

      />
      <Select
        label="Variable"
        placeholder={
          loadingVars ? "Loading variables..." :
          value.table   ? "Type to search variables..." :
          "Select a table first"
        }
        data={selectData}
        value={value.variable || null}
        onChange={(v) => onChange({ ...value, variable: v ?? "" })}
        disabled={!value.table || loadingVars}
        searchable
        clearable

        rightSection={loadingVars ? <Loader size="xs" /> : undefined}
        maxDropdownHeight={320}
        nothingFoundMessage="No variables match — try a different search"
      />
      <Select
        label="Group Filter"
        data={GROUP_OPTIONS}
        value={value.group}
        onChange={(v) => onChange({ ...value, group: v ?? "all" })}
      />
    </Stack>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ResearchContent() {
  // ── Mode ─────────────────────────────────────────────────────────────────
  const [pageMode, setPageMode] = useState<"metric" | "timeseries">("metric");

  // ── Metric mode state ─────────────────────────────────────────────────────
  const [xVar, setXVar] = useState<VarSelector>(DEFAULT_VAR);
  const [yVar, setYVar] = useState<VarSelector>(DEFAULT_VAR);
  const [aggregation, setAggregation] = useState("byAthlete");
  const [trendlineMode, setTrendlineMode] = useState<"linear" | "polynomial" | "none">("linear");
  const [colorByAgeGroup, setColorByAgeGroup] = useState(true);
  const [selectedAthletes, setSelectedAthletes] = useState<string[]>([]);
  const [showAthleteFilter, setShowAthleteFilter] = useState(false);
  const [athleteOptions, setAthleteOptions] = useState<AthleteOption[]>([]);

  const [xVariables, setXVariables] = useState<VariableInfo[]>([]);
  const [yVariables, setYVariables] = useState<VariableInfo[]>([]);
  const [loadingXVars, setLoadingXVars] = useState(false);
  const [loadingYVars, setLoadingYVars] = useState(false);

  const [metricResult, setMetricResult] = useState<ResearchDataResponse | null>(null);
  const [metricLoading, setMetricLoading] = useState(false);
  const [metricError, setMetricError] = useState<string | null>(null);
  const [statsOpen, setStatsOpen] = useState(true);

  // ── Time series state ─────────────────────────────────────────────────────
  const [tsTable, setTsTable] = useState("pitching_markers");
  const [tsAllMetrics, setTsAllMetrics] = useState<string[]>([]);
  /** The ordered list of metric names the user has added to the chart */
  const [tsSelectedMetrics, setTsSelectedMetrics] = useState<string[]>([]);
  const [tsPendingMetric, setTsPendingMetric] = useState<string>("");
  const [tsGroup, setTsGroup] = useState("all");
  const [tsSelectedAthletes, setTsSelectedAthletes] = useState<string[]>([]);
  const [tsAvgMode, setTsAvgMode] = useState("byAthlete");
  const [tsLoadingMetrics, setTsLoadingMetrics] = useState(false);
  const [tsSeries, setTsSeries] = useState<TimeSeriesSeries[]>([]);
  const [tsLoading, setTsLoading] = useState(false);
  const [tsError, setTsError] = useState<string | null>(null);

  // ─── Load athletes once ─────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/dashboard/athletes?limit=2000")
      .then((r) => r.json())
      .then((data) => {
        setAthleteOptions(
          (data.items ?? []).map((a: { athlete_uuid: string; name: string }) => ({
            value: a.athlete_uuid,
            label: a.name,
          })),
        );
      })
      .catch(console.error);
  }, []);

  // ─── Load X variables ───────────────────────────────────────────────────
  useEffect(() => {
    if (!xVar.table) { setXVariables([]); return; }
    setLoadingXVars(true);
    fetch(`/api/dashboard/research/variables?table=${xVar.table}`)
      .then((r) => r.json())
      .then((d) => setXVariables(d.variables ?? []))
      .catch(console.error)
      .finally(() => setLoadingXVars(false));
  }, [xVar.table]);

  // ─── Load Y variables ───────────────────────────────────────────────────
  useEffect(() => {
    if (!yVar.table) { setYVariables([]); return; }
    setLoadingYVars(true);
    fetch(`/api/dashboard/research/variables?table=${yVar.table}`)
      .then((r) => r.json())
      .then((d) => setYVariables(d.variables ?? []))
      .catch(console.error)
      .finally(() => setLoadingYVars(false));
  }, [yVar.table]);

  // ─── Load TS metric list ────────────────────────────────────────────────
  useEffect(() => {
    setTsAllMetrics([]);
    setTsSelectedMetrics([]);
    setTsPendingMetric("");
    setTsLoadingMetrics(true);
    fetch(`/api/dashboard/research/timeseries?table=${tsTable}&mode=labels`)
      .then((r) => r.json())
      .then((d) => setTsAllMetrics(d.labels ?? []))
      .catch(console.error)
      .finally(() => setTsLoadingMetrics(false));
  }, [tsTable]);

  // ─── Load metric scatter data ───────────────────────────────────────────
  const loadMetricData = useCallback(async () => {
    if (!xVar.table || !xVar.variable || !yVar.table || !yVar.variable) return;
    setMetricLoading(true);
    setMetricError(null);
    setMetricResult(null);

    try {
      const params = new URLSearchParams({
        xTable:      xVar.table,
        xVariable:   xVar.variable,
        yTable:      yVar.table,
        yVariable:   yVar.variable,
        group:       xVar.group,
        aggregation,
      });
      if (selectedAthletes.length > 0) {
        params.set("athleteUuids", selectedAthletes.join(","));
      }
      const res = await fetch(`/api/dashboard/research/data?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Unknown error");
      }
      setMetricResult(await res.json() as ResearchDataResponse);
    } catch (err) {
      setMetricError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setMetricLoading(false);
    }
  }, [xVar, yVar, aggregation, selectedAthletes]);

  // ─── Load time series data ──────────────────────────────────────────────
  const loadTsData = useCallback(async () => {
    if (tsSelectedMetrics.length === 0) return;
    setTsLoading(true);
    setTsError(null);
    setTsSeries([]);

    try {
      const params = new URLSearchParams({
        table:      tsTable,
        mode:       "data",
        labelNames: tsSelectedMetrics.join(","),
        group:      tsGroup,
        avgMode:    tsAvgMode,
      });
      if (tsSelectedAthletes.length > 0) {
        params.set("athleteUuids", tsSelectedAthletes.join(","));
      }
      const res = await fetch(`/api/dashboard/research/timeseries?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Unknown error");
      }
      const data = await res.json();
      setTsSeries(data.series ?? []);
    } catch (err) {
      setTsError(err instanceof Error ? err.message : "Failed to load time series");
    } finally {
      setTsLoading(false);
    }
  }, [tsTable, tsSelectedMetrics, tsGroup, tsAvgMode, tsSelectedAthletes]);

  // Reset byTrial aggregation when tables differ
  useEffect(() => {
    if (aggregation === "byTrial" && !(xVar.table && yVar.table && xVar.table === yVar.table)) {
      setAggregation("byAthlete");
    }
  }, [xVar.table, yVar.table, aggregation]);

  // ─── Helpers ─────────────────────────────────────────────────────────────
  const sameTables    = xVar.table && yVar.table && xVar.table === yVar.table;
  const canLoadMetric = !!(xVar.table && xVar.variable && yVar.table && yVar.variable);
  const canLoadTs     = tsSelectedMetrics.length > 0;

  // Aggregation options — byTrial only available when same table
  const aggOptions = [
    { value: "byAthlete", label: "Mean / Athlete" },
    { value: "bySession", label: "Mean / Session" },
    ...(sameTables ? [{ value: "byTrial", label: "Every Trial (raw)" }] : []),
  ];

  // Metrics available to add (not yet added)
  const tsAddableMetrics = tsAllMetrics
    .filter((m) => !tsSelectedMetrics.includes(m))
    .map((m) => ({ value: m, label: m }));

  return (
    <Stack gap="lg">
      {/* ── Header ── */}
      <div>
        <Title order={1} mb={4}>Research</Title>
        <Text c="dimmed">
          Explore relationships between variables across tables, or visualise kinematic time-series curves.
        </Text>
      </div>

      <Tabs value={pageMode} onChange={(v) => setPageMode(v as "metric" | "timeseries")} variant="outline">
        <TabsList>
          <TabsTab value="metric">Metric Data (Scatter)</TabsTab>
          <TabsTab value="timeseries">Time Series (Kinematics)</TabsTab>
        </TabsList>

        {/* ═══════════════════════════════════════════════════════════════════
            METRIC DATA TAB
        ═════════════════════════════════════════════════════════════════════*/}
        <TabsPanel value="metric" pt="md">
          <Stack gap="md">
            <Card withBorder p="md">
              <Stack gap="md">
                {/* X / Y selectors */}
                <Group align="flex-start" grow wrap="wrap" gap="xl">
                  <VariableSelector
                    label="X Variable (Independent)"
                    value={xVar}
                    onChange={setXVar}
                    variables={xVariables}
                    loadingVars={loadingXVars}
                  />
                  <VariableSelector
                    label="Y Variable (Dependent)"
                    value={yVar}
                    onChange={setYVar}
                    variables={yVariables}
                    loadingVars={loadingYVars}
                  />
                </Group>

                <Divider />

                {/* Options row */}
                <Group align="flex-end" wrap="wrap" gap="md">
                  <div>
                    <Text size="xs" c="dimmed" mb={4}>Aggregation</Text>
                    <SegmentedControl
                      data={aggOptions}
                      value={aggregation}
                      onChange={setAggregation}
                      size="xs"
                    />
                    {aggregation === "byTrial" && (
                      <Text size="xs" c="blue" mt={4}>
                        Each dot = one individual trial. Only available when X and Y are from the same table.
                      </Text>
                    )}
                  </div>
                  <div>
                    <Text size="xs" c="dimmed" mb={4}>Trendline</Text>
                    <SegmentedControl
                      data={[
                        { value: "none",       label: "None" },
                        { value: "linear",     label: "Linear" },
                        { value: "polynomial", label: "Poly (deg 2)" },
                      ]}
                      value={trendlineMode}
                      onChange={(v) => setTrendlineMode(v as "linear" | "polynomial" | "none")}
                      size="xs"
                    />
                  </div>
                  <div>
                    <Text size="xs" c="dimmed" mb={6}>Colour dots by</Text>
                    <Switch
                      label="Age Group"
                      checked={colorByAgeGroup}
                      onChange={(e) => setColorByAgeGroup(e.currentTarget.checked)}
                      size="sm"
                    />
                  </div>
                </Group>

                {/* Athlete filter */}
                <Group justify="space-between">
                  <Button
                    variant="subtle"
                    size="xs"
                    onClick={() => setShowAthleteFilter((v) => !v)}
                  >
                    {showAthleteFilter ? "Hide athlete filter ▲" : "Filter specific athletes ▼"}
                    {selectedAthletes.length > 0 && (
                      <Badge size="xs" ml={6} color="blue">{selectedAthletes.length} selected</Badge>
                    )}
                  </Button>
                  {selectedAthletes.length > 0 && (
                    <Button variant="subtle" size="xs" color="red" onClick={() => setSelectedAthletes([])}>
                      Clear
                    </Button>
                  )}
                </Group>
                <Collapse in={showAthleteFilter}>
                  <MultiSelect
                    label="Athletes to include (leave blank = all)"
                    placeholder="Search by name..."
                    data={athleteOptions}
                    value={selectedAthletes}
                    onChange={setSelectedAthletes}
                    searchable
                    clearable
            
                    maxValues={100}
                  />
                </Collapse>

                <Group>
                  <Button
                    onClick={loadMetricData}
                    loading={metricLoading}
                    disabled={!canLoadMetric}
                    size="sm"
                  >
                    Load Data
                  </Button>
                  {!canLoadMetric && (
                    <Text size="xs" c="dimmed">Select both X and Y variables first.</Text>
                  )}
                </Group>
              </Stack>
            </Card>

            {metricError && (
              <Alert color="red" title="Error loading data">{metricError}</Alert>
            )}

            {metricResult && (
              <Stack gap="md">
                <Group gap="sm">
                  <Badge variant="light" color="blue">{metricResult.points.length} data points</Badge>
                  {metricResult.statistics.pearsonR !== null && (
                    <Badge variant="light" color={Math.abs(metricResult.statistics.pearsonR) > 0.5 ? "green" : "yellow"}>
                      r = {metricResult.statistics.pearsonR.toFixed(3)}
                    </Badge>
                  )}
                  {metricResult.statistics.rSquared !== null && (
                    <Badge variant="light" color="grape">
                      R² = {metricResult.statistics.rSquared.toFixed(3)}
                    </Badge>
                  )}
                  {metricResult.statistics.pValue !== null && (
                    <Badge variant="light" color={metricResult.statistics.pValue < 0.05 ? "teal" : "orange"}>
                      {metricResult.statistics.pValue < 0.0001 ? "p < 0.0001" : `p = ${metricResult.statistics.pValue.toFixed(4)}`}
                    </Badge>
                  )}
                </Group>

                <Card withBorder p="md">
                  <Text size="sm" fw={600} mb="sm">
                    {metricResult.xLabel} vs {metricResult.yLabel}
                  </Text>
                  <ScatterPlot
                    points={metricResult.points}
                    xLabel={metricResult.xLabel}
                    yLabel={metricResult.yLabel}
                    trendlineMode={trendlineMode}
                    statistics={metricResult.statistics}
                    colorByAgeGroup={colorByAgeGroup}
                  />
                </Card>

                <Card withBorder p="md">
                  <Group justify="space-between" mb="sm">
                    <Text size="sm" fw={600}>Statistics</Text>
                    <Button variant="subtle" size="xs" onClick={() => setStatsOpen((v) => !v)}>
                      {statsOpen ? "Collapse" : "Expand"}
                    </Button>
                  </Group>
                  <Collapse in={statsOpen}>
                    <StatisticsPanel
                      stats={metricResult.statistics}
                      xLabel={metricResult.xLabel}
                      yLabel={metricResult.yLabel}
                      trendlineMode={trendlineMode}
                    />
                  </Collapse>
                </Card>
              </Stack>
            )}
          </Stack>
        </TabsPanel>

        {/* ═══════════════════════════════════════════════════════════════════
            TIME SERIES TAB
        ═════════════════════════════════════════════════════════════════════*/}
        <TabsPanel value="timeseries" pt="md">
          <Stack gap="md">
            <Card withBorder p="md">
              <Stack gap="md">

                {/* Table + options row */}
                <Group align="flex-end" wrap="wrap" gap="md">
                  <Select
                    label="Kinematic Table"
                    data={TS_TABLE_OPTIONS}
                    value={tsTable}
                    onChange={(v) => setTsTable(v ?? "pitching_markers")}
                    style={{ minWidth: 220 }}
                  />
                  <Select
                    label="Group"
                    data={GROUP_OPTIONS}
                    value={tsGroup}
                    onChange={(v) => setTsGroup(v ?? "all")}
                    style={{ minWidth: 160 }}
                  />
                  <div>
                    <Text size="xs" c="dimmed" mb={4}>Lines per</Text>
                    <SegmentedControl
                      data={[
                        { value: "byAthlete",  label: "Avg per athlete" },
                        { value: "bySessions", label: "Per session" },
                      ]}
                      value={tsAvgMode}
                      onChange={setTsAvgMode}
                      size="xs"
                    />
                  </div>
                </Group>

                <Divider label="Variables to plot" labelPosition="left" />

                {/* ── Add-a-variable row ── */}
                <Stack gap="xs">
                  <Group align="flex-end" gap="sm" wrap="nowrap">
                    <Select
                      label={`Add variable to chart (${tsSelectedMetrics.length}/8 added)`}
                      placeholder={tsLoadingMetrics ? "Loading..." : "Search and select..."}
                      data={tsAddableMetrics}
                      value={tsPendingMetric || null}
                      onChange={(v) => setTsPendingMetric(v ?? "")}
                      disabled={tsLoadingMetrics || tsAllMetrics.length === 0 || tsSelectedMetrics.length >= 8}
                      searchable
                      clearable

                      rightSection={tsLoadingMetrics ? <Loader size="xs" /> : undefined}
                      nothingFoundMessage="No variables match"
                      maxDropdownHeight={300}
                      style={{ flex: 1 }}
                    />
                    <Button
                      variant="light"
                      size="sm"
                      disabled={!tsPendingMetric || tsSelectedMetrics.includes(tsPendingMetric)}
                      onClick={() => {
                        if (tsPendingMetric && !tsSelectedMetrics.includes(tsPendingMetric)) {
                          setTsSelectedMetrics((prev) => [...prev, tsPendingMetric]);
                          setTsPendingMetric("");
                        }
                      }}
                      style={{ alignSelf: "flex-end", marginBottom: 1 }}
                    >
                      + Add Line
                    </Button>
                  </Group>

                  {/* Current metric chips */}
                  {tsSelectedMetrics.length > 0 && (
                    <Group gap="xs" wrap="wrap">
                      {tsSelectedMetrics.map((m, i) => (
                        <Badge
                          key={m}
                          variant="light"
                          color="blue"
                          size="md"
                          rightSection={
                            <CloseButton
                              size="xs"
                              onClick={() =>
                                setTsSelectedMetrics((prev) => prev.filter((x) => x !== m))
                              }
                            />
                          }
                        >
                          {m}
                        </Badge>
                      ))}
                      <Button
                        variant="subtle"
                        size="xs"
                        color="red"
                        onClick={() => setTsSelectedMetrics([])}
                      >
                        Clear all
                      </Button>
                    </Group>
                  )}
                </Stack>

                <Divider label="Athlete filter" labelPosition="left" />

                <MultiSelect
                  label="Athletes to include (leave blank = all, max 30 series per metric shown)"
                  placeholder="Search by name..."
                  data={athleteOptions}
                  value={tsSelectedAthletes}
                  onChange={setTsSelectedAthletes}
                  searchable
                  clearable
          
                  maxValues={30}
                />

                <Group>
                  <Button
                    onClick={loadTsData}
                    loading={tsLoading}
                    disabled={!canLoadTs}
                    size="sm"
                  >
                    Plot Time Series
                  </Button>
                  {!canLoadTs && (
                    <Text size="xs" c="dimmed">Add at least one variable above.</Text>
                  )}
                </Group>
              </Stack>
            </Card>

            {tsError && <Alert color="red" title="Error">{tsError}</Alert>}

            {tsSeries.length > 0 && (
              <Card withBorder p="md">
                <Group justify="space-between" mb="sm">
                  <Text size="sm" fw={600}>
                    {tsSelectedMetrics.join(" · ")}
                  </Text>
                  <Group gap="xs">
                    <Badge variant="light">{tsSeries.length} series</Badge>
                    <Badge variant="light" color="gray">
                      {TS_TABLE_LABEL[tsTable] ?? tsTable}
                    </Badge>
                  </Group>
                </Group>
                <TimeSeriesPlot
                  series={tsSeries}
                  metricNames={tsSelectedMetrics}
                />
                <Text size="xs" c="dimmed" mt="sm">
                  Hover for exact values. 3-D vector quantities are split into separate X, Y, Z charts.
                  {tsSelectedMetrics.length > 1 && " Different variables share the Y axis — check units before comparing scales."}
                </Text>
              </Card>
            )}

            {tsSeries.length === 0 && !tsLoading && tsSelectedMetrics.length > 0 && !tsError && (
              <Text c="dimmed" size="sm" ta="center" mt="md">
                No data found. Try different variables, group, or athletes.
              </Text>
            )}
          </Stack>
        </TabsPanel>
      </Tabs>
    </Stack>
  );
}
