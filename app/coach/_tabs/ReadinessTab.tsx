"use client";

import useSWR from "swr";
import type { ReadinessDashboardPayload } from "@/app/dashboard/readiness-screen/types";
import { ReadinessDashboard } from "@/app/dashboard/readiness-screen/ReadinessScreenContent";
import { readinessKey, swrOpts } from "../_components/fetcher";
import { LoadState } from "./shared";

export function ReadinessTab({ athleteUuid }: { athleteUuid: string }) {
  const { data, error, isLoading } = useSWR<ReadinessDashboardPayload>(readinessKey(athleteUuid), swrOpts);
  if (!data) return <LoadState isLoading={isLoading} error={error} />;
  return (
    <div style={{ maxWidth: 960 }}>
      <ReadinessDashboard data={data} />
    </div>
  );
}
