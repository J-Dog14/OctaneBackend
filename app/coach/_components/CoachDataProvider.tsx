"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import useSWR, { SWRConfig, useSWRConfig } from "swr";
import { coachFetcher, createCoachFetcher, swrOpts } from "./fetcher";
import { useUserActive } from "@/hooks/useUserActive";

type PopulationStatus = { version: string; ready: number; pending: number; failed: number };
const PopulationStatusContext = createContext<PopulationStatus | undefined>(undefined);
export const usePopulationStatus = () => useContext(PopulationStatusContext);

function PopulationUpdates({ fetcher, children }: { fetcher: ReturnType<typeof createCoachFetcher>; children: React.ReactNode }) {
  const { mutate } = useSWRConfig();
  const previous = useRef<string | undefined>(undefined);
  // Poll only while someone is using the tab; an idle/hidden tab makes no requests.
  const active = useUserActive();
  const { data, mutate: refreshStatus } = useSWR<PopulationStatus>("/api/coach/populations/status", coachFetcher, {
    ...swrOpts, refreshInterval: active ? 15_000 : 0, dedupingInterval: 5_000,
  });
  const wasActive = useRef(active);
  useEffect(() => {
    // Catch up immediately when the user comes back instead of waiting 15 s.
    if (active && !wasActive.current) void refreshStatus();
    wasActive.current = active;
  }, [active, refreshStatus]);
  useEffect(() => {
    if (!data) return;
    fetcher.setPopulationVersion(data.version);
    if (previous.current !== undefined && previous.current !== data.version) {
      // Revalidate mounted views while retaining their displayed data.
      void mutate((key) => typeof key === "string" ? key.startsWith("/api/coach/athletes/") : Array.isArray(key));
    }
    previous.current = data.version;
  }, [data, fetcher, mutate]);
  return <PopulationStatusContext.Provider value={data}>{children}</PopulationStatusContext.Provider>;
}

/** Remounted by CoachGuard on account changes, isolating all athlete data. */
export function CoachDataProvider({ children }: { children: React.ReactNode }) {
  const [config] = useState(() => {
    const cache = new Map();
    return { ...swrOpts, provider: () => cache, fetcher: createCoachFetcher() };
  });
  return <SWRConfig value={config}><PopulationUpdates fetcher={config.fetcher}>{children}</PopulationUpdates></SWRConfig>;
}
