"use client";

import { useEffect, useRef, useState } from "react";
import { useAthleteSearch } from "@/hooks";
import { useReportStream } from "@/hooks";
import { AthleteSearchDropdown } from "./components/AthleteSearchDropdown";
import { ReportTypeSelector } from "./components/ReportTypeSelector";
import { JobOutputDisplay } from "@/app/dashboard/components/JobOutputDisplay";
import type { ReportTypeId } from "./constants";

export function ReportsContent() {
  const [reportType, setReportType] = useState<ReportTypeId>("athletic-screen");
  const outputEndRef = useRef<HTMLDivElement>(null);

  const athleteSearch = useAthleteSearch();
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

        {error && (
          <p className="text-danger" style={{ marginBottom: "0.75rem", fontSize: "14px" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            type="button"
            className="btn"
            disabled={streaming || !athleteSearch.athleteSelected}
            onClick={() => generateReport(athleteSearch.athleteSelected, reportType)}
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
