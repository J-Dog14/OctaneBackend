"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminGuard } from "@/app/dashboard/AdminGuard";

type AthleteOption = { athlete_uuid: string; name: string };

const REPORT_TYPES = [
  { id: "athletic-screen", label: "Athletic Screen" },
  { id: "pro-sup", label: "Pro-Sup" },
  { id: "arm-action", label: "Arm Action" },
  { id: "curveball", label: "Curveball" },
] as const;

type ReportTypeId = (typeof REPORT_TYPES)[number]["id"];

export default function ReportsPage() {
  const [athleteQuery, setAthleteQuery] = useState("");
  const [athleteOptions, setAthleteOptions] = useState<AthleteOption[]>([]);
  const [athleteSelected, setAthleteSelected] = useState<AthleteOption | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [reportType, setReportType] = useState<ReportTypeId>("athletic-screen");
  const [output, setOutput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAthletes = useCallback(async (q: string) => {
    const params = new URLSearchParams({ limit: "50" });
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/dashboard/athletes?${params}`);
    const data = await res.json();
    if (res.ok && Array.isArray(data?.items)) {
      setAthleteOptions(data.items.map((a: AthleteOption) => ({ athlete_uuid: a.athlete_uuid, name: a.name })));
    } else {
      setAthleteOptions([]);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchAthletes(athleteQuery);
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [athleteQuery, fetchAthletes]);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  const generateReport = async () => {
    if (!athleteSelected) {
      setError("Select an athlete first.");
      return;
    }
    setError(null);
    setOutput("");
    setStreaming(true);

    try {
      const res = await fetch("/api/dashboard/uais/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runnerId: reportType,
          athleteUuid: athleteSelected.athlete_uuid,
          reportOnly: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to start report");
        setStreaming(false);
        return;
      }
      const jobId = data.jobId;
      if (!jobId) {
        setError("No job ID returned");
        setStreaming(false);
        return;
      }

      const label = REPORT_TYPES.find((r) => r.id === reportType)?.label ?? reportType;
      setOutput(`——— ${label} Report ———\n`);

      const sres = await fetch(`/api/dashboard/uais/stream?jobId=${encodeURIComponent(jobId)}`);
      if (!sres.ok) {
        const errData = await sres.json().catch(() => ({}));
        setOutput((prev) => prev + `\n[Error] ${errData.error ?? sres.statusText}\n`);
        setStreaming(false);
        return;
      }
      const reader = sres.body?.getReader();
      if (!reader) {
        setOutput((prev) => prev + "\n[Error] No stream body\n");
        setStreaming(false);
        return;
      }
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setOutput((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      setOutput((prev) => prev + `\n[Error] ${e instanceof Error ? e.message : "Unknown error"}\n`);
    } finally {
      setStreaming(false);
    }
  };

  return (
    <AdminGuard>
    <div>
      <h1 style={{ marginBottom: "0.5rem", fontSize: "1.75rem" }}>PDF Reports</h1>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Generate a PDF report for an athlete from existing database data.
      </p>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        {/* Athlete search */}
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}>
            Athlete
          </label>
          <div style={{ position: "relative", width: 300 }}>
            <input
              type="text"
              placeholder="Search by name…"
              value={athleteSelected ? athleteSelected.name : athleteQuery}
              onChange={(e) => {
                setAthleteSelected(null);
                setAthleteQuery(e.target.value);
                setDropdownOpen(true);
              }}
              onFocus={() => setDropdownOpen(true)}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
            />
            {dropdownOpen && athleteOptions.length > 0 && !athleteSelected && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  zIndex: 10,
                  maxHeight: 220,
                  overflowY: "auto",
                }}
              >
                {athleteOptions.map((a) => (
                  <button
                    key={a.athlete_uuid}
                    type="button"
                    className="btn-ghost"
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 12px",
                      fontSize: "14px",
                      borderRadius: 0,
                    }}
                    onMouseDown={() => {
                      setAthleteSelected(a);
                      setAthleteQuery("");
                      setDropdownOpen(false);
                    }}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {athleteSelected && (
            <div style={{ marginTop: "0.4rem", fontSize: "13px", color: "var(--text-secondary)" }}>
              Selected: <strong>{athleteSelected.name}</strong>{" "}
              <button
                type="button"
                className="btn-ghost"
                style={{ fontSize: "12px", padding: "1px 6px" }}
                onClick={() => { setAthleteSelected(null); setAthleteQuery(""); }}
              >
                ×
              </button>
            </div>
          )}
        </div>

        {/* Report type */}
        <div style={{ marginBottom: "1.25rem" }}>
          <label style={{ display: "block", fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}>
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

        {error && (
          <p className="text-danger" style={{ marginBottom: "0.75rem", fontSize: "14px" }}>{error}</p>
        )}

        <button
          type="button"
          className="btn"
          disabled={streaming || !athleteSelected}
          onClick={generateReport}
          style={{ padding: "8px 20px" }}
        >
          {streaming ? "Generating…" : "Generate Report"}
        </button>
      </div>

      {output && (
        <div className="card">
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Output</h3>
          <pre
            style={{
              margin: 0,
              fontFamily: "monospace",
              fontSize: "13px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              lineHeight: 1.5,
              maxHeight: 400,
              overflowY: "auto",
            }}
          >
            {output}
          </pre>
          <div ref={outputEndRef} />
        </div>
      )}
    </div>
    </AdminGuard>
  );
}
