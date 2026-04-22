"use client";

import { REPORT_TYPES, type ReportTypeId } from "@/app/dashboard/reports/constants";

interface Props {
  reportType: ReportTypeId;
  setReportType: (t: ReportTypeId) => void;
}

export function ReportTypeSelector({ reportType, setReportType }: Props) {
  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <label
        style={{ display: "block", fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}
      >
        Report Type
      </label>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {REPORT_TYPES.map((r) => (
          <button
            key={r.id}
            type="button"
            className="btn-ghost"
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: `1px solid ${reportType === r.id ? "var(--accent)" : "var(--border)"}`,
              background: reportType === r.id ? "var(--accent-muted)" : "var(--bg-tertiary)",
              color: reportType === r.id ? "var(--accent)" : "var(--text-secondary)",
              fontWeight: reportType === r.id ? 600 : 400,
            }}
            onClick={() => setReportType(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
