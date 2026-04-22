"use client";

import { useEffect, useState } from "react";
import type { ReportTypeId } from "@/app/dashboard/reports/constants";

export function useSessionDates(athleteUuid: string | undefined, reportType: ReportTypeId) {
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!athleteUuid) {
      setDates([]);
      setSelectedDate(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setDates([]);
    setSelectedDate(null);

    fetch(
      `/api/dashboard/reports/sessions?athleteUuid=${encodeURIComponent(athleteUuid)}&reportType=${encodeURIComponent(reportType)}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const fetched: string[] = Array.isArray(data?.dates) ? data.dates : [];
        setDates(fetched);
        // Auto-select the most recent date
        setSelectedDate(fetched.length > 0 ? fetched[0] : null);
      })
      .catch(() => {
        if (cancelled) return;
        setDates([]);
        setSelectedDate(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [athleteUuid, reportType]);

  return { dates, selectedDate, setSelectedDate, loading };
}
