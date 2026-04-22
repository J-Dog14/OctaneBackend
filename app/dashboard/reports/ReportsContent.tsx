"use client";

import { useEffect, useRef, useState } from "react";
import { useAthleteSearch, useReportStream, useSessionDates } from "@/hooks";
import { AthleteSearchDropdown } from "./components/AthleteSearchDropdown";
import { ReportTypeSelector } from "./components/ReportTypeSelector";
import { JobOutputDisplay } from "@/app/dashboard/components/JobOutputDisplay";
import type { ReportTypeId } from "./constants";

const formatSessionDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export function ReportsContent() {
  const [reportType, setReportType] = useState<ReportTypeId>("athletic-screen");
  const outputEndRef = useRef<HTMLDivElement>(null);

  const athleteSearch = useAthleteSearch();
  const sessionDates = useSessionDates(athleteSearch.athleteSelected?.athlete_uuid, reportType);
  const { output, reportLinks, streaming, error, cancelReport, generateReport } = useReportStream();

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  return (
    <div>
      <h1 style={{ marginBottom: "0.5rem", fontSize: "1.75rem" }}>PDF Reports</h1>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Generate a PDF report for an athlete from existing database data.
      </p>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <AthleteSearchDropdown {...athleteSearch} />
        <ReportTypeSelector reportType={reportType} setReportType={setReportType} />

        {/* Session Date Picker — shown once an athlete is selected */}
        {athleteSearch.athleteSelected && (
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
            {sessionDates.loading ? (
              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                Loading sessions…
              </p>
            ) : sessionDates.dates.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                No sessions found for this athlete and report type.
              </p>
            ) : (
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
            )}
          </div>
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
            disabled={
              streaming || !athleteSearch.athleteSelected || !sessionDates.selectedDate
            }
            onClick={() =>
              generateReport(
                athleteSearch.athleteSelected,
                reportType,
                sessionDates.selectedDate
              )
            }
            style={{ padding: "8px 20px" }}
          >
            {streaming ? "Generating…" : "Generate Report"}
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
