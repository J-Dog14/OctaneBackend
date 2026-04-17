"use client";

import { useCallback, useEffect, useState } from "react";
import type { Runner } from "@/app/dashboard/uais-maintenance/types";

export function useUaisRunners() {
  const [runners, setRunners] = useState<Runner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runnerDataPaths, setRunnerDataPaths] = useState<Record<string, string>>({});

  const loadRunners = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/uais/runners");
      const data = (await res.json()) as {
        runners?: Runner[];
        dataDirs?: Record<string, string>;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load runners");
      setRunners(data.runners ?? []);
      if (data.dataDirs) setRunnerDataPaths(data.dataDirs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load runners");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRunners();
  }, [loadRunners]);

  return { runners, loading, error, runnerDataPaths, setRunnerDataPaths, loadRunners };
}
