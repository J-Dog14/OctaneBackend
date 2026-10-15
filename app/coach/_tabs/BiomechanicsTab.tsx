"use client";

import { useState } from "react";
import { SegmentedControl, Stack } from "@mantine/core";
import type { CoachAthleteSummary } from "@/lib/coach/summary";
import { DomainSwitcher } from "../_components/DomainWorkspace";
import { BiomechReport } from "../_reports/BiomechReport";
import { LoadState, pickDomains, useTracking } from "./shared";

/**
 * Pitching 3D opens on the 8-cylinder report (same read as the
 * biomech-pitching-breakdown PDF). "Metrics explorer" keeps the percentile
 * tables, timelines and comparisons for pitching, hitting and arm action.
 */
export function BiomechanicsTab({ athleteUuid, summary }: { athleteUuid: string; summary: CoachAthleteSummary }) {
  const hasPitching = summary.trackingDomains.includes("pitching");
  const [view, setView] = useState<"report" | "explorer">(hasPitching ? "report" : "explorer");
  const { data, error, isLoading } = useTracking(athleteUuid);

  return (
    <Stack gap="md">
      {hasPitching && (
        <SegmentedControl
          w="fit-content"
          value={view}
          onChange={(v) => setView(v as "report" | "explorer")}
          data={[
            { value: "report", label: "Pitching report" },
            { value: "explorer", label: "Metrics explorer" },
          ]}
        />
      )}
      {view === "report" && hasPitching ? (
        <BiomechReport athleteUuid={athleteUuid} />
      ) : !data ? (
        <LoadState isLoading={isLoading} error={error} />
      ) : (
        <DomainSwitcher
          athleteUuid={athleteUuid}
          domains={pickDomains(data, ["pitching", "hitting", "armAction"])}
          datesByDomain={summary.trackingDates}
          emptyText="No biomechanics captures for this athlete yet."
        />
      )}
    </Stack>
  );
}
