"use client";

import type { CoachAthleteSummary } from "@/lib/coach/summary";
import { DomainSwitcher } from "../_components/DomainWorkspace";
import { LoadState, pickDomains, useTracking } from "./shared";

export function ProteusTab({ athleteUuid, summary }: { athleteUuid: string; summary: CoachAthleteSummary }) {
  const { data, error, isLoading } = useTracking(athleteUuid);
  if (!data) return <LoadState isLoading={isLoading} error={error} />;
  return (
    <DomainSwitcher
      athleteUuid={athleteUuid}
      domains={pickDomains(data, ["proteus"])}
      datesByDomain={summary.trackingDates}
      emptyText="No Proteus sessions for this athlete yet."
    />
  );
}
