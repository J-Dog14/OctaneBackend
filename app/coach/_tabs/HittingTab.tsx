"use client";

import { useState } from "react";
import { SegmentedControl, Stack } from "@mantine/core";
import type { CoachAthleteSummary } from "@/lib/coach/summary";
import { DomainSwitcher } from "../_components/DomainWorkspace";
import { HittingReport } from "../_reports/HittingReport";
import { LoadState, pickDomains, useTracking } from "./shared";

/**
 * Hitting opens on the swing-checkpoint report (same read as the
 * hitting-swing-breakdown PDF). "Metrics explorer" keeps the percentile
 * tables, timelines and comparisons, laid out like the pitching explorer.
 */
export function HittingTab({ athleteUuid, summary }: { athleteUuid: string; summary: CoachAthleteSummary }) {
  const [view, setView] = useState<"report" | "explorer">("report");
  const { data, error, isLoading } = useTracking(athleteUuid);
  const hasExplorer = summary.trackingDomains.includes("hitting");

  return (
    <Stack gap="md">
      <SegmentedControl
        w="fit-content"
        value={view}
        onChange={(v) => setView(v as "report" | "explorer")}
        data={[
          { value: "report", label: "Hitting report" },
          { value: "explorer", label: "Metrics explorer", disabled: !hasExplorer },
        ]}
      />
      {view === "report" ? (
        <HittingReport athleteUuid={athleteUuid} />
      ) : !data ? (
        <LoadState isLoading={isLoading} error={error} />
      ) : (
        <DomainSwitcher
          athleteUuid={athleteUuid}
          domains={pickDomains(data, ["hitting"])}
          datesByDomain={summary.trackingDates}
          emptyText="No hitting captures for this athlete yet."
        />
      )}
    </Stack>
  );
}
