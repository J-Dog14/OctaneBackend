"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAthleteSearch, useReportStream, useSessionDates } from "@/hooks";
import { AthleteSearchDropdown } from "./components/AthleteSearchDropdown";
import { ReportTypeSelector } from "./components/ReportTypeSelector";
import { ComparisonSessionPicker } from "./components/ComparisonSessionPicker";
import { JobOutputDisplay } from "@/app/dashboard/components/JobOutputDisplay";
import {
  COMPARISON_CAPABLE,
  MIN_COMPARISON_SESSIONS,
  type ReportMode,
  type ReportTypeId,
} from "./constants";

const formatSessionDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const MODES: { id: ReportMode; label: string; hint: string }[] = [
  { id: "single", label: "Single Session", hint: "One screen, scored against the database." },
  {
    id: "comparison",
    label: "Compare Sessions",
    hint: "Two to four screens, with what changed and where it sits.",
  },
];

export function ReportsContent() {
  const [reportType, setReportType] = useState<ReportTypeId>("athletic-screen");
  const [mode, setMode] = useState<ReportMode>("single");
  const outputEndRef = useRef<HTMLDivElement>(null);

  const athleteSearch = useAthleteSearch();
  const sessionDates = useSessionDates(athleteSearch.athleteSelected?.athlete_uuid, reportType);
  const { output, reportLinks, streaming, error, cancelReport, generateReport } = useReportStream();

  const supportsComparison = COMPARISON_CAPABLE.includes(reportType);

  // Switching to a report type with no comparison pipeline drops back to
  // single rather than leaving a mode selected that can't be run.
  useEffect(() => {
    if (!supportsComparison) setMode("single");
  }, [supportsComparison]);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  const comparing = mode === "comparison";

  const canGenerate = useMemo(() => {
    if (streaming || !athleteSearch.athleteSelected) return false;
    if (comparing) return sessionDates.comparisonDates.length >= MIN_COMPARISON_SESSIONS;
    return Boolean(sessionDates.selectedDate);
  }, [
    streaming,
    athleteSearch.athleteSelected,
    comparing,
    sessionDates.comparisonDates.length,
    sessionDates.selectedDate,
  ]);

  const handleGenerate = () =>
    generateReport(athleteSearch.athleteSelected, reportType, {
      mode,
      sessionDate: sessionDates.selectedDate,
      sessionDates: sessionDates.comparisonDates,
    });

  return (
    <div>
      <h1 style={{ marginBottom: "0.5rem", fontSize: "1.75rem" }}>PDF Reports</h1>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Generate a PDF report for an athlete from existing database data.
      </p>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <AthleteSearchDropdown {...athleteSearch} />
        <ReportTypeSelector reportType={reportType} setReportType={setReportType} />

        {supportsComparison && (
          <div style={{ marginBottom: "1.25rem" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.9rem",
                fontWeight: 600,
                marginBottom: "0.4rem",
              }}
            >
              Report Mode
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="btn-ghost"
                  title={m.hint}
                  aria-pressed={mode === m.id}
                  onClick={() => setMode(m.id)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: `1px solid ${mode === m.id ? "var(--accent)" : "var(--border)"}`,
                    background: mode === m.id ? "var(--accent-muted)" : "var(--bg-tertiary)",
                    color: mode === m.id ? "var(--accent)" : "var(--text-secondary)",
                    fontWeight: mode === m.id ? 600 : 400,
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p
              style={{
                fontSize: "0.8rem",
                color: "var(--text-secondary)",
                margin: "0.4rem 0 0",
              }}
            >
              {MODES.find((m) => m.id === mode)?.hint}
            </p>
          </div>
        )}

        {/* Session picker — shown once an athlete is selected */}
        {athleteSearch.athleteSelected && (
          <>
            {sessionDates.loading ? (
              <p
                style={{
                  fontSize: "0.85rem",
                  color: "var(--text-secondary)",
                  marginBottom: "1.25rem",
                }}
              >
                Loading sessions…
              </p>
            ) : sessionDates.dates.length === 0 ? (
              <p
                style={{
                  fontSize: "0.85rem",
                  color: "var(--text-secondary)",
                  marginBottom: "1.25rem",
                }}
              >
                No sessions found for this athlete and report type.
              </p>
            ) : comparing ? (
              <ComparisonSessionPicker
                sessions={sessionDates.sessions}
                comparisonDates={sessionDates.comparisonDates}
                toggleDate={sessionDates.toggleDate}
                resetToDefault={sessionDates.resetToDefault}
                selectAllAvailable={sessionDates.selectAllAvailable}
              />
            ) : (
              <div style={{ marginBottom: "1.25rem" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.9rem",
                    fontWeight: 600,
                    marginBottom: "0.4rem",
                  }}
                >
                  Session Date
                </label>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  {sessionDates.dates.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className="btn-ghost"
                      style={{
                        padding: "6px 14px",
                        borderRadius: 6,
                        border: `1px solid ${
                          sessionDates.selectedDate === d ? "var(--accent)" : "var(--border)"
                        }`,
                        background:
                          sessionDates.selectedDate === d
                            ? "var(--accent-muted)"
                            : "var(--bg-tertiary)",
                        color:
                          sessionDates.selectedDate === d
                            ? "var(--accent)"
                            : "var(--text-secondary)",
                        fontWeight: sessionDates.selectedDate === d ? 600 : 400,
                      }}
                      onClick={() => sessionDates.setSelectedDate(d)}
                    >
                      {formatSessionDate(d)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {error && (
          <p className="text-danger" style={{ marginBottom: "0.75rem", fontSize: "14px" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            type="button"
            className="btn"
            disabled={!canGenerate}
            onClick={handleGenerate}
            style={{ padding: "8px 20px" }}
          >
            {streaming
              ? "Generating…"
              : comparing
                ? `Generate Comparison (${sessionDates.comparisonDates.length})`
                : "Generate Report"}
          </button>
          {streaming && (
            <button
              type="button"
              className="btn-ghost"
              onClick={cancelReport}
              style={{ padding: "8px 16px" }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <JobOutputDisplay output={output} reportLinks={reportLinks} outputEndRef={outputEndRef} />
    </div>
  );
}
