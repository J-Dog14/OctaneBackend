"use client";

import { useState } from "react";
import useSWR from "swr";
import { Title, Text, Stack, Tabs, TabsList, TabsTab, TabsPanel } from "@mantine/core";
import { MetricTab } from "./components/MetricTab";
import { TimeSeriesTab } from "./components/TimeSeriesTab";
import type { AthleteOption } from "./types";

export function ResearchContent() {
  const [pageMode, setPageMode] = useState<"metric" | "timeseries">("metric");

  // Shared across both tabs
  const { data: athleteOptions = [] } = useSWR<AthleteOption[]>(
    "/api/dashboard/athletes?limit=2000",
    (url: string) =>
      fetch(url)
        .then((r) => r.json())
        .then((data) =>
          (data.items ?? []).map((a: { athlete_uuid: string; name: string }) => ({
            value: a.athlete_uuid,
            label: a.name,
          }))
        ),
    { revalidateOnFocus: false, dedupingInterval: 300_000 }
  );

  return (
    <Stack gap="lg">
      <div>
        <Title order={1} mb={4}>Research</Title>
        <Text c="dimmed">
          Explore relationships between variables across tables, or visualise kinematic time-series
          curves.
        </Text>
      </div>

      <Tabs
        value={pageMode}
        onChange={(v) => setPageMode(v as "metric" | "timeseries")}
        variant="outline"
      >
        <TabsList>
          <TabsTab value="metric">Metric Data (Scatter)</TabsTab>
          <TabsTab value="timeseries">Time Series (Kinematics)</TabsTab>
        </TabsList>

        <TabsPanel value="metric" pt="md">
          <MetricTab athleteOptions={athleteOptions} />
        </TabsPanel>

        <TabsPanel value="timeseries" pt="md">
          <TimeSeriesTab athleteOptions={athleteOptions} />
        </TabsPanel>
      </Tabs>
    </Stack>
  );
}
