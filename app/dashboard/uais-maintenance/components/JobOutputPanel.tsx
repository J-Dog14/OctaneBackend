"use client";

import type React from "react";

interface ReportLink {
  filename: string;
  url: string;
}

interface RunProgress {
  current: number;
  total: number;
  label: string;
}

interface Props {
  output: string;
  activeJob: { jobId: string; label: string } | null;
  streaming: boolean;
  runSelectedProgress: RunProgress | null;
  inputValue: string;
  setInputValue: (v: string) => void;
  reportLinks: ReportLink[];
  outputEndRef: React.RefObject<HTMLDivElement | null>;
  onSendInput: () => void;
  onKill: () => void;
}

export function JobOutputPanel({
  output,
  activeJob,
  streaming,
  runSelectedProgress,
  inputValue,
  setInputValue,
  reportLinks,
  outputEndRef,
  onSendInput,
  onKill,
}: Props) {
  if (!output && !activeJob && !streaming && !runSelectedProgress) return null;

  const title = runSelectedProgress
    ? `Running ${runSelectedProgress.current} of ${runSelectedProgress.total}: ${runSelectedProgress.label}`
    : activeJob
      ? `${activeJob.label} — running`
      : "Output";

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.5rem",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1rem" }}>{title}</h2>
        {reportLinks.length > 0 && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {reportLinks.map((r) => (
              <a
                key={r.url}
                href={r.url}
                download={r.filename}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost"
                style={{ fontSize: "12px", padding: "0.25rem 0.6rem" }}
              >
                ↓ {r.filename}
              </a>
            ))}
          </div>
        )}
      </div>
      <pre
        style={{
          margin: 0,
          padding: "0.75rem",
          background: "var(--bg-primary)",
          borderRadius: "6px",
          fontSize: "13px",
          fontFamily: "var(--font-mono)",
          maxHeight: "400px",
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {output || (streaming ? "Starting…" : "")}
        <span ref={outputEndRef} />
      </pre>
      {activeJob && (
        <div
          style={{
            marginTop: "0.75rem",
            display: "flex",
            gap: "0.5rem",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSendInput()}
            placeholder="Type input for the process (e.g. 1 for conflict) and press Enter"
            style={{ flex: 1 }}
          />
          <button type="button" className="btn-primary" onClick={onSendInput}>
            Send
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={onKill}
            style={{ color: "var(--accent-secondary, #e53e3e)", borderColor: "currentColor" }}
          >
            Kill
          </button>
        </div>
      )}
    </div>
  );
}
