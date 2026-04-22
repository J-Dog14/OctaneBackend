"use client";

import type React from "react";

interface ReportLink {
  filename: string;
  url: string;
}

interface Props {
  output: string;
  reportLinks: ReportLink[];
  outputEndRef: React.RefObject<HTMLDivElement | null>;
}

export function JobOutputDisplay({ output, reportLinks, outputEndRef }: Props) {
  if (!output && reportLinks.length === 0) return null;

  return (
    <div className="card">
      <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Output</h3>
      {reportLinks.length > 0 && (
        <div style={{ marginBottom: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {reportLinks.map((r) => (
            <a
              key={r.url}
              href={r.url}
              download={r.filename}
              className="btn"
              style={{ fontSize: "13px", padding: "5px 12px" }}
            >
              Download {r.filename}
            </a>
          ))}
        </div>
      )}
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
  );
}
