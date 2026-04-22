"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  Card,
  Stack,
  Group,
  Text,
  Button,
  Badge,
  Alert,
  Select,
  MultiSelect,
  SegmentedControl,
  Divider,
  Loader,
  CloseButton,
} from "@mantine/core";
import { TS_TABLE_OPTIONS, TS_TABLE_LABEL, GROUP_OPTIONS } from "../constants";
import type { TimeSeriesSeries } from "@/app/api/dashboard/research/timeseries/route";
import type { AthleteOption } from "../types";

const TimeSeriesPlot = dynamic(
  () => import("../TimeSeriesPlot").then((m) => ({ default: m.TimeSeriesPlot })),
  { ssr: false }
);

interface Props {
  athleteOptions: AthleteOption[];
}

export function TimeSeriesTab({ athleteOptions }: Props) {
  const [tsTable, setTsTable] = useState("pitching_markers");
  const [tsAllMetrics, setTsAllMetrics] = useState<string[]>([]);
  const [tsSelectedMetrics, setTsSelectedMetrics] = useState<string[]>([]);
  const [tsPendingMetric, setTsPendingMetric] = useState<string>("");
  const [tsGroup, setTsGroup] = useState("all");
  const [tsSelectedAthletes, setTsSelectedAthletes] = useState<string[]>([]);
  const [tsAvgMode, setTsAvgMode] = useState("byAthlete");
  const [tsLoadingMetrics, setTsLoadingMetrics] = useState(false);
  const [tsSeries, setTsSeries] = useState<TimeSeriesSeries[]>([]);
  const [tsLoading, setTsLoading] = useState(false);
  const [tsError, setTsError] = useState<string | null>(null);

  // ── Load metric list when table changes ───────────────────────────────────
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

  // ── Load time series data ─────────────────────────────────────────────────
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

  const canLoadTs = tsSelectedMetrics.length > 0;
  const tsAddableMetrics = tsAllMetrics
    .filter((m) => !tsSelectedMetrics.includes(m))
    .map((m) => ({ value: m, label: m }));

  return (
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

          {/* Add-a-variable row */}
          <Stack gap="xs">
            <Group align="flex-end" gap="sm" wrap="nowrap">
              <Select
                label={`Add variable to chart (${tsSelectedMetrics.length}/8 added)`}
                placeholder={tsLoadingMetrics ? "Loading..." : "Search and select..."}
                data={tsAddableMetrics}
                value={tsPendingMetric || null}
                onChange={(v) => setTsPendingMetric(v ?? "")}
                disabled={
                  tsLoadingMetrics || tsAllMetrics.length === 0 || tsSelectedMetrics.length >= 8
                }
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

            {tsSelectedMetrics.length > 0 && (
              <Group gap="xs" wrap="wrap">
                {tsSelectedMetrics.map((m) => (
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
            <Button onClick={loadTsData} loading={tsLoading} disabled={!canLoadTs} size="sm">
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
            <Text size="sm" fw={600}>{tsSelectedMetrics.join(" · ")}</Text>
            <Group gap="xs">
              <Badge variant="light">{tsSeries.length} series</Badge>
              <Badge variant="light" color="gray">
                {TS_TABLE_LABEL[tsTable] ?? tsTable}
              </Badge>
            </Group>
          </Group>
          <TimeSeriesPlot series={tsSeries} metricNames={tsSelectedMetrics} />
          <Text size="xs" c="dimmed" mt="sm">
            Hover for exact values. 3-D vector quantities are split into separate X, Y, Z charts.
            {tsSelectedMetrics.length > 1 &&
              " Different variables share the Y axis — check units before comparing scales."}
          </Text>
        </Card>
      )}

      {tsSeries.length === 0 && !tsLoading && tsSelectedMetrics.length > 0 && !tsError && (
        <Text c="dimmed" size="sm" ta="center" mt="md">
          No data found. Try different variables, group, or athletes.
        </Text>
      )}
    </Stack>
  );
}
