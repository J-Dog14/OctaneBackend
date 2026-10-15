"use client";

import { useEffect } from "react";
import { useSWRConfig } from "swr";
import type { CoachAthleteSummary } from "@/lib/coach/summary";
import { useCoachFetcher } from "./fetcher";
import { warmAthleteData } from "./prefetch";

export function useAthletePrefetch(summary: CoachAthleteSummary | undefined, paused: boolean) {
  const fetcher = useCoachFetcher();
  const { mutate } = useSWRConfig();
  useEffect(() => {
    if (!summary || paused) return;
    // Respect data-saving connections for speculative downloads.
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "")) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (document.visibilityState === "hidden") return;
      void warmAthleteData(summary, async (key) => {
        const data = await fetcher(key);
        if (!cancelled) await mutate(key, data, { revalidate: false });
        return data;
      }, () => cancelled || document.visibilityState === "hidden");
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [summary, paused, fetcher, mutate]);
}
