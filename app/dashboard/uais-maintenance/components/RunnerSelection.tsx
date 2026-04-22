"use client";

import type { Runner } from "@/app/dashboard/uais-maintenance/types";

interface Props {
  runners: Runner[];
  selectedRunnerIds: Set<string>;
  onToggleRunner: (id: string) => void;
  streaming: boolean;
  dataMode: "local" | "cloud";
  agentOnline: boolean;
  runnerDataPaths: Record<string, string>;
  setRunnerDataPaths: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export function RunnerSelection({
  runners,
  selectedRunnerIds,
  onToggleRunner,
  streaming,
  dataMode,
  agentOnline,
  runnerDataPaths,
  setRunnerDataPaths,
}: Props) {
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
        {runners.map((r) => {
          const selected = selectedRunnerIds.has(r.id);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => !streaming && onToggleRunner(r.id)}
              disabled={streaming}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: selected ? "rgba(34, 197, 94, 0.25)" : "var(--bg-primary)",
                color: "var(--text-primary)",
                cursor: streaming ? "not-allowed" : "pointer",
                fontWeight: selected ? 600 : 400,
                transition: "background 0.15s ease",
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      {/* Per-runner data path inputs — shown when cloud mode, agent online, runners selected */}
      {dataMode === "cloud" && agentOnline && selectedRunnerIds.size > 0 && (
        <div
          style={{
            margin: "0.75rem 0",
            padding: "0.75rem 1rem",
            border: "1px solid var(--border)",
            borderRadius: "8px",
          }}
        >
          <p style={{ margin: "0 0 0.5rem", fontSize: "13px", fontWeight: 600 }}>
            Data folder paths
          </p>
          <p className="text-muted" style={{ margin: "0 0 0.75rem", fontSize: "12px" }}>
            Pre-filled from Settings. Edit to point at a specific session folder before running.
          </p>
          {runners
            .filter((r) => selectedRunnerIds.has(r.id))
            .map((r) => (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginBottom: "0.5rem",
                  flexWrap: "wrap",
                }}
              >
                <label style={{ fontSize: "13px", minWidth: "120px", fontWeight: 500 }}>
                  {r.label}
                </label>
                <input
                  type="text"
                  value={runnerDataPaths[r.id] ?? ""}
                  onChange={(e) =>
                    setRunnerDataPaths((prev) => ({ ...prev, [r.id]: e.target.value }))
                  }
                  placeholder="e.g. D:/Data/Sessions/2024-03-25/"
                  style={{ flex: 1, minWidth: "260px", padding: "0.3rem 0.5rem", fontSize: "13px" }}
                  disabled={streaming}
                />
              </div>
            ))}
        </div>
      )}
    </>
  );
}
