"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import useSWR, { SWRConfig, useSWRConfig } from "swr";
import { coachFetcher, createCoachFetcher, swrOpts } from "./fetcher";

type PopulationStatus = { version: string; ready: number; pending: number; failed: number };
const PopulationStatusContext = createContext<PopulationStatus | undefined>(undefined);
export const usePopulationStatus = () => useContext(PopulationStatusContext);

function PopulationUpdates({ fetcher, children }: { fetcher: ReturnType<typeof createCoachFetcher>; children: React.ReactNode }) {
  const { mutate } = useSWRConfig();
  const previous = useRef<string | undefined>(undefined);
  const { data } = useSWR<PopulationStatus>("/api/coach/populations/status", coachFetcher, {
    ...swrOpts, refreshInterval: 15_000, dedupingInterval: 5_000,
  });
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
