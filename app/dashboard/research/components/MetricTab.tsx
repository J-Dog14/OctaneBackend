"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Card,
  Stack,
  Group,
  Text,
  Button,
  Badge,
  Alert,
  SegmentedControl,
  Switch,
  MultiSelect,
  Collapse,
  Select,
  Divider,
} from "@mantine/core";
import { StatisticsPanel } from "../StatisticsPanel";
import { VariableSelector } from "./VariableSelector";
import { computeStatistics } from "@/lib/research/statistics";
import type { VariableInfo } from "@/app/api/dashboard/research/variables/route";
import type { ResearchDataResponse } from "@/app/api/dashboard/research/data/route";
import type { AthleteOption, VarSelector } from "../types";
import { DEFAULT_VAR } from "../types";

const ScatterPlot = dynamic(
  () => import("../ScatterPlot").then((m) => ({ default: m.ScatterPlot })),
  { ssr: false }
);

interface Props {
  athleteOptions: AthleteOption[];
}

export function MetricTab({ athleteOptions }: Props) {
  const [xVar, setXVar] = useState<VarSelector>(DEFAULT_VAR);
  const [yVar, setYVar] = useState<VarSelector>(DEFAULT_VAR);
  const [aggregation, setAggregation] = useState("byAthlete");
  const [trendlineMode, setTrendlineMode] = useState<"linear" | "polynomial" | "none">("linear");
  const [colorByAgeGroup, setColorByAgeGroup] = useState(true);
  const [selectedAthletes, setSelectedAthletes] = useState<string[]>([]);
  const [showAthleteFilter, setShowAthleteFilter] = useState(false);

  const [xVariables, setXVariables] = useState<VariableInfo[]>([]);
  const [yVariables, setYVariables] = useState<VariableInfo[]>([]);
  const [xMovements, setXMovements] = useState<string[]>([]);
  const [yMovements, setYMovements] = useState<string[]>([]);
  const [loadingXVars, setLoadingXVars] = useState(false);
  const [loadingYVars, setLoadingYVars] = useState(false);

  const [metricResult, setMetricResult] = useState<ResearchDataResponse | null>(null);
  const [metricLoading, setMetricLoading] = useState(false);
  const [metricError, setMetricError] = useState<string | null>(null);
  const [statsOpen, setStatsOpen] = useState(true);
  const [outlierMethod, setOutlierMethod] = useState<"none" | "iqr" | "zscore">("none");
  const [outlierThreshold, setOutlierThreshold] = useState("1.5");

  // ── Load X variables ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!xVar.table) {
      setXVariables([]);
      setXMovements([]);
      return;
    }
    setLoadingXVars(true);
    fetch(`/api/dashboard/research/variables?table=${xVar.table}`)
      .then((r) => r.json())
      .then((d) => {
        setXVariables(d.variables ?? []);
        setXMovements(d.movements ?? []);
      })
      .catch(console.error)
      .finally(() => setLoadingXVars(false));
  }, [xVar.table]);

  // ── Load Y variables ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!yVar.table) {
      setYVariables([]);
      setYMovements([]);
      return;
    }
    setLoadingYVars(true);
    fetch(`/api/dashboard/research/variables?table=${yVar.table}`)
      .then((r) => r.json())
      .then((d) => {
        setYVariables(d.variables ?? []);
        setYMovements(d.movements ?? []);
      })
      .catch(console.error)
      .finally(() => setLoadingYVars(false));
  }, [yVar.table]);

  // Auto-select aggregation mode based on whether both variables are from the same table
  useEffect(() => {
    if (xVar.table && yVar.table) {
      if (xVar.table === yVar.table) {
        setAggregation("byTrial");
      } else {
        setAggregation((prev) => (prev === "byTrial" ? "byRound" : prev));
      }
    }
  }, [xVar.table, yVar.table]);

  // ── Load metric data ─────────────────────────────────────────────────────
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
        groups:      xVar.groups.join(","),
        aggregation,
      });
      if (xVar.exerciseName) params.set("xMovement", xVar.exerciseName);
      if (yVar.exerciseName) params.set("yMovement", yVar.exerciseName);
      if (selectedAthletes.length > 0) params.set("athleteUuids", selectedAthletes.join(","));
      const res = await fetch(`/api/dashboard/research/data?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Unknown error");
      }
      setMetricResult((await res.json()) as ResearchDataResponse);
    } catch (err) {
      setMetricError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setMetricLoading(false);
    }
  }, [xVar, yVar, aggregation, selectedAthletes]);

  // ── Outlier filtering ─────────────────────────────────────────────────────
  const filteredPoints = useMemo(() => {
    const pts = metricResult?.points ?? [];
    if (outlierMethod === "none" || pts.length < 4) return pts;
    const threshold = parseFloat(outlierThreshold);

    if (outlierMethod === "iqr") {
      function iqrBounds(vals: number[]): [number, number] {
        const sorted = [...vals].sort((a, b) => a - b);
        const n = sorted.length;
        const q1 = sorted[Math.floor(n * 0.25)]!;
        const q3 = sorted[Math.floor(n * 0.75)]!;
        const iqr = q3 - q1;
        return [q1 - threshold * iqr, q3 + threshold * iqr];
      }
      const [xLo, xHi] = iqrBounds(pts.map((p) => p.x));
      const [yLo, yHi] = iqrBounds(pts.map((p) => p.y));
      return pts.filter((p) => p.x >= xLo && p.x <= xHi && p.y >= yLo && p.y <= yHi);
    }

    if (outlierMethod === "zscore") {
      function zBounds(vals: number[]): [number, number] {
        const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
        const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
        return [mean - threshold * std, mean + threshold * std];
      }
      const [xLo, xHi] = zBounds(pts.map((p) => p.x));
      const [yLo, yHi] = zBounds(pts.map((p) => p.y));
      return pts.filter((p) => p.x >= xLo && p.x <= xHi && p.y >= yLo && p.y <= yHi);
    }

    return pts;
  }, [metricResult, outlierMethod, outlierThreshold]);

  const removedCount = (metricResult?.points.length ?? 0) - filteredPoints.length;
  const filteredStats = useMemo(
    () =>
      removedCount > 0
        ? computeStatistics(
            filteredPoints.map((p) => p.x),
            filteredPoints.map((p) => p.y)
          )
        : (metricResult?.statistics ?? null),
    [filteredPoints, removedCount, metricResult]
  );

  const sameTables = xVar.table && yVar.table && xVar.table === yVar.table;
  const canLoadMetric = !!(xVar.table && xVar.variable && yVar.table && yVar.variable);
  const aggOptions = [
    { value: "byAthlete", label: "Mean / Athlete" },
    { value: "bySession", label: "Mean / Session" },
    { value: "byRound",   label: "By Assessment Round" },
    ...(sameTables ? [{ value: "byTrial", label: "Every Trial (raw)" }] : []),
  ];

  return (
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
              movements={xMovements}
            />
            <VariableSelector
              label="Y Variable (Dependent)"
              value={yVar}
              onChange={setYVar}
              variables={yVariables}
              loadingVars={loadingYVars}
              movements={yMovements}
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
                  Each dot = one individual trial. Only available when X and Y are from the same
                  table.
                </Text>
              )}
              {aggregation === "byRound" && (
                <Text size="xs" c="blue" mt={4}>
                  Sessions are averaged per assessment block (within 14 days per table). Rounds
                  from different tables are matched when their representative dates are within 30
                  days — ideal for cross-table comparisons like pitching vs athletic screen.
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
              <Text size="xs" c="dimmed" mb={4}>Outlier Filter</Text>
              <Group gap="xs" wrap="nowrap">
                <SegmentedControl
                  data={[
                    { value: "none",   label: "None" },
                    { value: "iqr",    label: "IQR" },
                    { value: "zscore", label: "Z-score" },
                  ]}
                  value={outlierMethod}
                  onChange={(v) => {
                    setOutlierMethod(v as "none" | "iqr" | "zscore");
                    if (v === "iqr")    setOutlierThreshold("1.5");
                    if (v === "zscore") setOutlierThreshold("2.5");
                  }}
                  size="xs"
                />
                {outlierMethod !== "none" && (
                  <Select
                    size="xs"
                    style={{ width: 80 }}
                    data={
                      outlierMethod === "iqr"
                        ? [
                            { value: "1.5", label: "1.5×" },
                            { value: "2.0", label: "2.0×" },
                            { value: "3.0", label: "3.0×" },
                          ]
                        : [
                            { value: "2.0", label: "2.0σ" },
                            { value: "2.5", label: "2.5σ" },
                            { value: "3.0", label: "3.0σ" },
                          ]
                    }
                    value={outlierThreshold}
                    onChange={(v) => setOutlierThreshold(v ?? outlierThreshold)}
                    allowDeselect={false}
                  />
                )}
              </Group>
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
                <Badge size="xs" ml={6} color="blue">
                  {selectedAthletes.length} selected
                </Badge>
              )}
            </Button>
            {selectedAthletes.length > 0 && (
              <Button
                variant="subtle"
                size="xs"
                color="red"
                onClick={() => setSelectedAthletes([])}
              >
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
            <Button onClick={loadMetricData} loading={metricLoading} disabled={!canLoadMetric} size="sm">
              Load Data
            </Button>
            {!canLoadMetric && (
              <Text size="xs" c="dimmed">Select both X and Y variables first.</Text>
            )}
          </Group>
        </Stack>
      </Card>

      {metricError && <Alert color="red" title="Error loading data">{metricError}</Alert>}

      {metricResult && (
        <Stack gap="md">
          <Group gap="sm">
            <Badge variant="light" color="blue">{filteredPoints.length} data points</Badge>
            {removedCount > 0 && (
              <Badge variant="light" color="orange">
                {removedCount} outlier{removedCount > 1 ? "s" : ""} removed
              </Badge>
            )}
            {filteredStats?.pearsonR != null && (
              <Badge
                variant="light"
                color={Math.abs(filteredStats.pearsonR) > 0.5 ? "green" : "yellow"}
              >
                r = {filteredStats.pearsonR.toFixed(3)}
              </Badge>
            )}
            {filteredStats?.rSquared != null && (
              <Badge variant="light" color="grape">
                R² = {filteredStats.rSquared.toFixed(3)}
              </Badge>
            )}
            {filteredStats?.pValue != null && (
              <Badge
                variant="light"
                color={filteredStats.pValue < 0.05 ? "teal" : "orange"}
              >
                {filteredStats.pValue < 0.0001
                  ? "p < 0.0001"
                  : `p = ${filteredStats.pValue.toFixed(4)}`}
              </Badge>
            )}
          </Group>

          <Card withBorder p="md">
            <Text size="sm" fw={600} mb="sm">
              {metricResult.xLabel} vs {metricResult.yLabel}
            </Text>
            <ScatterPlot
              points={filteredPoints}
              xLabel={metricResult.xLabel}
              yLabel={metricResult.yLabel}
              trendlineMode={trendlineMode}
              statistics={filteredStats ?? metricResult.statistics}
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
                stats={filteredStats ?? metricResult.statistics}
                xLabel={metricResult.xLabel}
                yLabel={metricResult.yLabel}
                trendlineMode={trendlineMode}
              />
            </Collapse>
          </Card>
        </Stack>
      )}
    </Stack>
  );
}
