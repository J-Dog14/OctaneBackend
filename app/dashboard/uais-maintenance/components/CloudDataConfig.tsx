"use client";

import type { UploadedFile } from "@/app/dashboard/uais-maintenance/types";

interface Props {
  dataMode: "local" | "cloud";
  setDataMode: (m: "local" | "cloud") => void;
  streaming: boolean;
  agentOnline: boolean;
  syncStatus: string | null;
  r2Available: boolean | null;
  uploadedFiles: UploadedFile[];
  uploading: boolean;
  uploadError: string | null;
  selectedRunnerIds: Set<string>;
  onFileSelect: (files: FileList | null) => void;
  onRemoveFile: (key: string) => void;
}

export function CloudDataConfig({
  dataMode,
  setDataMode,
  streaming,
  agentOnline,
  syncStatus,
  r2Available,
  uploadedFiles,
  uploading,
  uploadError,
  selectedRunnerIds,
  onFileSelect,
  onRemoveFile,
}: Props) {
  return (
    <>
      <h2 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>Which data to run</h2>

      {/* Data mode toggle */}
      <div style={{ marginBottom: "0.75rem", display: "flex", gap: "0.5rem" }}>
        {(["local", "cloud"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => !streaming && setDataMode(mode)}
            disabled={streaming}
            style={{
              padding: "0.3rem 0.9rem",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: dataMode === mode ? "rgba(34,197,94,0.25)" : "var(--bg-primary)",
              color: "var(--text-primary)",
              fontWeight: dataMode === mode ? 600 : 400,
              cursor: streaming ? "not-allowed" : "pointer",
              fontSize: "13px",
            }}
          >
            {mode === "local" ? "Local" : "Cloud (sync agent)"}
          </button>
        ))}
      </div>

      {dataMode === "local" && (
        <p className="text-muted" style={{ marginBottom: "0.75rem", fontSize: "13px" }}>
          Scripts run directly using the data directories configured in Settings. No file transfer
          needed.
        </p>
      )}

      {dataMode === "cloud" && (
        <>
          <div
            style={{
              marginBottom: "0.75rem",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: agentOnline ? "#22c55e" : "#6b7280",
              }}
            />
            <span className="text-muted" style={{ fontSize: "13px" }}>
              {agentOnline
                ? "OctaneSync agent online — files will be fetched automatically"
                : "OctaneSync agent offline — upload files manually below, or install the sync agent"}
            </span>
            {syncStatus && (
              <span style={{ fontSize: "13px", color: "var(--accent)" }}>{syncStatus}</span>
            )}
          </div>

          {/* Manual upload — shown when agent offline and R2 is available */}
          {r2Available && !agentOnline && selectedRunnerIds.size > 0 && (
            <div
              style={{
                margin: "1rem 0",
                padding: "0.75rem 1rem",
                border: "1px dashed var(--border)",
                borderRadius: "8px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "0.5rem",
                }}
              >
                <span style={{ fontSize: "14px", fontWeight: 600 }}>Upload data files</span>
                <span className="text-muted" style={{ fontSize: "12px" }}>
                  Files are sent to the cloud processor before running
                </span>
              </div>
              {uploadError && (
                <p
                  style={{ color: "var(--error, #e53e3e)", fontSize: "13px", margin: "0 0 0.5rem" }}
                >
                  {uploadError}
                </p>
              )}
              <label
                style={{ display: "inline-block", cursor: "pointer" }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  onFileSelect(e.dataTransfer.files);
                }}
              >
                <input
                  type="file"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => onFileSelect(e.target.files)}
                  disabled={uploading || streaming}
                />
                <span className="btn-ghost" style={{ pointerEvents: "none" }}>
                  {uploading ? "Uploading…" : "Choose files or drop here"}
                </span>
              </label>
              {uploadedFiles.length > 0 && (
                <ul
                  style={{
                    listStyle: "none",
                    margin: "0.5rem 0 0",
                    padding: 0,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                  }}
                >
                  {uploadedFiles.map((f) => (
                    <li
                      key={f.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                        padding: "0.3rem 0.6rem",
                        background: "rgba(34,197,94,0.15)",
                        borderRadius: "6px",
                        fontSize: "13px",
                      }}
                    >
                      <span>{f.filename}</span>
                      <span className="text-muted">({(f.size / 1024).toFixed(0)} KB)</span>
                      <button
                        type="button"
                        onClick={() => onRemoveFile(f.key)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--text-secondary)",
                          fontSize: "14px",
                          lineHeight: 1,
                          padding: "0 2px",
                        }}
                        title="Remove"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
