"use client";

import { useEffect, useRef } from "react";
import { useReportStream, useSessionDates } from "@/hooks";
import { ComparisonSessionPicker } from "@/app/dashboard/reports/components/ComparisonSessionPicker";
import { JobOutputDisplay } from "@/app/dashboard/components/JobOutputDisplay";
import { MIN_COMPARISON_SESSIONS } from "@/app/dashboard/reports/constants";

export type ComparisonTarget = {
  athleteUuid: string;
  name: string;
  /**
   * "post-run": raised automatically after an Athletic Screen insertion — stays
   *   hidden unless the athlete actually has enough sessions to compare.
   * "manual": opened from the button — always shows, even to say there
   *   aren't enough sessions.
   */
  source: "post-run" | "manual";
  /** Run immediately with the default selection (two most recent sessions). */
  autoRun: boolean;
  /** Bumped per raise so the session list refetches after new data lands. */
  refreshKey: number;
};

interface Props {
  target: ComparisonTarget | null;
  onClose: () => void;
}

/**
 * Athletic Screen comparison report, run from the UAIS Maintenance page.
 *
 * Same session picker and pipeline as the PDF Reports page — the report is
 * generated from what's already in the warehouse via
 * `/api/dashboard/uais/run` with `reportOnly` + `reportMode: "comparison"`.
 */
export function ComparisonReportPanel({ target, onClose }: Props) {
  const outputEndRef = useRef<HTMLDivElement>(null);
  const sessionDates = useSessionDates(
    target?.athleteUuid,
    "athletic-screen",
    target?.refreshKey ?? 0
  );
  const { output, reportLinks, streaming, error, cancelReport, generateReport } = useReportStream();

  const enough = sessionDates.sessions.length >= MIN_COMPARISON_SESSIONS;

  // Auto-run once per raise, as soon as the session list has loaded.
  const autoRanForRef = useRef<number | null>(null);
  useEffect(() => {
    if (!target?.autoRun || sessionDates.loading || !enough) return;
    if (autoRanForRef.current === target.refreshKey) return;
    if (sessionDates.comparisonDates.length < MIN_COMPARISON_SESSIONS) return;
    autoRanForRef.current = target.refreshKey;
    void generateReport({ athlete_uuid: target.athleteUuid, name: target.name }, "athletic-screen", {
      mode: "comparison",
      sessionDates: sessionDates.comparisonDates,
    });
  }, [target, sessionDates.loading, sessionDates.comparisonDates, enough, generateReport]);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  if (!target) return null;
  // Post-run prompt only appears when there's something to compare.
  if (target.source === "post-run" && (sessionDates.loading || !enough) && !output) return null;

  const runComparison = () =>
    generateReport({ athlete_uuid: target.athleteUuid, name: target.name }, "athletic-screen", {
      mode: "comparison",
      sessionDates: sessionDates.comparisonDates,
    });

  return (
    <div
      className="card"
      style={{
        marginTop: "1rem",
        marginBottom: "1rem",
        borderColor: "var(--accent)",
        borderWidth: "1px",
        borderStyle: "solid",
      }}
    >
      <h3 style={{ margin: "0 0 0.5rem" }}>Athletic Screen Comparison Report</h3>

      {sessionDates.loading ? (
        <p className="text-muted" style={{ fontSize: "0.85rem" }}>
          Checking athletic screen sessions…
        </p>
      ) : (
        <>
          {enough && (
            <p className="text-muted" style={{ marginBottom: "0.75rem" }}>
              It looks like <strong>{target.name}</strong> has {sessionDates.sessions.length}{" "}
              athletic screen sessions. Do you want to create a comparison report?
            </p>
          )}
          <ComparisonSessionPicker
            sessions={sessionDates.sessions}
            comparisonDates={sessionDates.comparisonDates}
            toggleDate={sessionDates.toggleDate}
            resetToDefault={sessionDates.resetToDefault}
            selectAllAvailable={sessionDates.selectAllAvailable}
          />
        </>
      )}

      {error && (
        <p className="text-danger" style={{ marginBottom: "0.75rem", fontSize: "14px" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
        {enough && (
          <button
            type="button"
            className="btn-primary"
            disabled={
              streaming || sessionDates.comparisonDates.length < MIN_COMPARISON_SESSIONS
            }
            onClick={() => void runComparison()}
          >
            {streaming
              ? "Generating…"
              : `Run Comparison (${sessionDates.comparisonDates.length})`}
          </button>
        )}
        {streaming ? (
          <button type="button" className="btn-ghost" onClick={() => void cancelReport()}>
            Cancel
          </button>
        ) : (
          <button type="button" className="btn-ghost" onClick={onClose}>
            {output ? "Close" : "No thanks"}
          </button>
        )}
      </div>

      <JobOutputDisplay output={output} reportLinks={reportLinks} outputEndRef={outputEndRef} />
    </div>
  );
}
