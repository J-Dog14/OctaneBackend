"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReportTypeId } from "@/app/dashboard/reports/constants";
import { MAX_COMPARISON_SESSIONS, MIN_COMPARISON_SESSIONS } from "@/app/dashboard/reports/constants";

export type SessionDetail = { date: string; movements: string[] };

/**
 * Session dates for the selected athlete + report type.
 *
 * Carries two independent selections so switching between Single and
 * Comparison mode never loses what you had picked:
 *   - `selectedDate`  the one date a single-session report runs on
 *   - `selectedDates` the 2-4 dates a comparison runs on
 *
 * Both default to the most recent data available: single picks the newest
 * session, comparison picks the two newest — the overwhelmingly common
 * "how did he do since last time" case — while still letting you reach back
 * and select every session the athlete has.
 */
export function useSessionDates(athleteUuid: string | undefined, reportType: ReportTypeId) {
  const [sessions, setSessions] = useState<SessionDetail[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!athleteUuid) {
      setSessions([]);
      setSelectedDate(null);
      setSelectedDates([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setSessions([]);
    setSelectedDate(null);
    setSelectedDates([]);

    fetch(
      `/api/dashboard/reports/sessions?athleteUuid=${encodeURIComponent(athleteUuid)}&reportType=${encodeURIComponent(reportType)}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const fetchedDates: string[] = Array.isArray(data?.dates) ? data.dates : [];
        const fetchedSessions: SessionDetail[] = Array.isArray(data?.sessions)
          ? data.sessions
          : fetchedDates.map((date) => ({ date, movements: [] }));

        setSessions(fetchedSessions);
        // Most recent session for a single report...
        setSelectedDate(fetchedDates.length > 0 ? fetchedDates[0] : null);
        // ...and the two most recent for a comparison.
        setSelectedDates(fetchedDates.slice(0, MIN_COMPARISON_SESSIONS));
      })
      .catch(() => {
        if (cancelled) return;
        setSessions([]);
        setSelectedDate(null);
        setSelectedDates([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [athleteUuid, reportType]);

  const dates = useMemo(() => sessions.map((s) => s.date), [sessions]);

  const movementsFor = useCallback(
    (date: string) => sessions.find((s) => s.date === date)?.movements ?? [],
    [sessions]
  );

  /**
   * Toggle a date in the comparison selection. Selecting past the maximum
   * drops the oldest pick rather than refusing the click — the cap is a
   * legibility limit on the report, not a rule the user should have to
   * manage by hand.
   */
  const toggleDate = useCallback((date: string) => {
    setSelectedDates((prev) => {
      if (prev.includes(date)) {
        return prev.filter((d) => d !== date);
      }
      const next = [...prev, date].sort((a, b) => b.localeCompare(a));
      if (next.length <= MAX_COMPARISON_SESSIONS) return next;
      // Keep the newest N; the oldest selection falls off.
      return next.slice(0, MAX_COMPARISON_SESSIONS);
    });
  }, []);

  /** Select the two most recent sessions — the comparison default. */
  const resetToDefault = useCallback(() => {
    setSelectedDates(dates.slice(0, MIN_COMPARISON_SESSIONS));
  }, [dates]);

  /** Select as many of the most recent sessions as the report allows. */
  const selectAllAvailable = useCallback(() => {
    setSelectedDates(dates.slice(0, MAX_COMPARISON_SESSIONS));
  }, [dates]);

  // Chronological, oldest first — the order the report reads left to right.
  const comparisonDates = useMemo(
    () => [...selectedDates].sort((a, b) => a.localeCompare(b)),
    [selectedDates]
  );

  return {
    sessions,
    dates,
    loading,
    movementsFor,
    // single-session
    selectedDate,
    setSelectedDate,
    // comparison
    selectedDates,
    comparisonDates,
    toggleDate,
    resetToDefault,
    selectAllAvailable,
  };
}
