"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * AI program data sync — pushes the ai_layer data Octane's program generator
 * needs, right from the Send to App page:
 *   - per-athlete: latest AI profile  → Octane /api/biomech/profile
 *   - population:  corpus (profiles + prescription history) → /api/biomech/corpus
 *
 * The report payload above feeds Octane's report viewer; THIS feeds the
 * Athlete Programs (AI) generator. An athlete appears there once their
 * profile has been sent.
 */

type ProfileStatus =
  | { exists: true; asOfDate: string; role: string; metricCount: number }
  | { exists: false };

type SendState =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "success"; message: string }
  | { phase: "error"; message: string };

type CorpusState =
  | { phase: "idle" }
  | { phase: "running"; sent: number; total: number; failures: string[] }
  | { phase: "done"; sent: number; total: number; failures: string[] }
  | { phase: "error"; message: string };

const pillStyle: React.CSSProperties = {
  fontSize: "11px",
  padding: "2px 8px",
  borderRadius: 20,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

export function AiSyncSection({
  athleteSelected,
}: {
  athleteSelected: { athlete_uuid: string; name: string } | null;
}) {
  const [profileStatus, setProfileStatus] = useState<ProfileStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [sendState, setSendState] = useState<SendState>({ phase: "idle" });
  const [corpusState, setCorpusState] = useState<CorpusState>({ phase: "idle" });
  const corpusCancelled = useRef(false);

  // Load profile status whenever the athlete changes
  useEffect(() => {
    setSendState({ phase: "idle" });
    if (!athleteSelected) {
      setProfileStatus(null);
      return;
    }
    setStatusLoading(true);
    fetch(
      `/api/dashboard/ai-sync/profile-status?athleteUuid=${athleteSelected.athlete_uuid}`
    )
      .then((r) => r.json())
      .then((d) => setProfileStatus(d as ProfileStatus))
      .catch(() => setProfileStatus(null))
      .finally(() => setStatusLoading(false));
  }, [athleteSelected]);

  const handleSendProfile = useCallback(async () => {
    if (!athleteSelected) return;
    setSendState({ phase: "sending" });
    try {
      const res = await fetch("/api/dashboard/ai-sync/send-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteUuid: athleteSelected.athlete_uuid }),
      });
      const data = (await res.json()) as {
        error?: string;
        athlete?: string;
        asOfDate?: string;
        metrics?: number;
      };
      if (!res.ok) {
        setSendState({ phase: "error", message: data.error ?? "Unknown error" });
      } else {
        setSendState({
          phase: "success",
          message: `Profile sent (${data.metrics} metrics, as of ${data.asOfDate}). ${data.athlete} is now available in Octane → Athlete Programs.`,
        });
      }
    } catch (err) {
      setSendState({
        phase: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, [athleteSelected]);

  const handleSyncCorpus = useCallback(async () => {
    corpusCancelled.current = false;
    let cursor: string | null = null;
    let sent = 0;
    let total = 0;
    const failures: string[] = [];

    setCorpusState({ phase: "running", sent: 0, total: 0, failures: [] });
    try {
      do {
        const res: Response = await fetch("/api/dashboard/ai-sync/send-corpus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cursor, batchSize: 10 }),
        });
        const data = (await res.json()) as {
          error?: string;
          sent?: number;
          failed?: Array<{ athlete: string; error: string }>;
          nextCursor?: string | null;
          total?: number;
        };
        if (!res.ok) throw new Error(data.error ?? "Batch failed");

        sent += data.sent ?? 0;
        total = data.total ?? total;
        for (const f of data.failed ?? []) failures.push(`${f.athlete}: ${f.error}`);
        cursor = data.nextCursor ?? null;

        setCorpusState({ phase: "running", sent, total, failures: [...failures] });
      } while (cursor !== null && !corpusCancelled.current);

      setCorpusState({ phase: "done", sent, total, failures });
    } catch (err) {
      setCorpusState({
        phase: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, []);

  return (
    <div className="card" style={{ marginBottom: "1.5rem" }}>
      <h2 style={{ margin: "0 0 0.25rem", fontSize: "1rem" }}>
        AI program data (Athlete Programs)
      </h2>
      <p className="text-muted" style={{ fontSize: "13px", marginBottom: "0.75rem" }}>
        The report payload above feeds Octane&apos;s report viewer. This section feeds the{" "}
        <strong>AI program generator</strong>: send an athlete&apos;s deficit profile to make
        them generatable, and sync the corpus (all profiles + coach prescription history)
        that powers similar-athlete matching.
      </p>

      {/* Per-athlete profile send */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        {!athleteSelected ? (
          <span className="text-muted" style={{ fontSize: "13px" }}>
            Select an athlete above to send their AI profile.
          </span>
        ) : statusLoading ? (
          <span className="text-muted" style={{ fontSize: "13px" }}>
            Checking AI profile…
          </span>
        ) : profileStatus?.exists ? (
          <>
            <span style={{ ...pillStyle, background: "#d3f9d8", color: "#2b8a3e" }}>
              Profile ready — {profileStatus.metricCount} metrics, {profileStatus.asOfDate} (
              {profileStatus.role})
            </span>
            <button
              className="btn btn-primary"
              onClick={handleSendProfile}
              disabled={sendState.phase === "sending"}
            >
              {sendState.phase === "sending" ? "Sending…" : "Send AI profile to Octane"}
            </button>
          </>
        ) : (
          <span style={{ ...pillStyle, background: "#ffe066", color: "#7a5900" }}>
            No AI profile in warehouse — run the profiler for this athlete first
          </span>
        )}
      </div>
      {sendState.phase === "success" && (
        <p style={{ fontSize: "13px", color: "#2b8a3e", marginTop: "0.5rem" }}>
          ✓ {sendState.message}
        </p>
      )}
      {sendState.phase === "error" && (
        <p style={{ fontSize: "13px", color: "#c92a2a", marginTop: "0.5rem" }}>
          {sendState.message}
        </p>
      )}

      {/* Corpus sync */}
      <div
        style={{
          marginTop: "1rem",
          paddingTop: "0.75rem",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <button
          className="btn"
          onClick={handleSyncCorpus}
          disabled={corpusState.phase === "running"}
        >
          {corpusState.phase === "running" ? "Syncing corpus…" : "Sync AI corpus (all athletes)"}
        </button>
        {corpusState.phase === "running" && (
          <>
            <span className="text-muted" style={{ fontSize: "13px" }}>
              {corpusState.sent}
              {corpusState.total ? ` / ${corpusState.total}` : ""} athletes sent
            </span>
            <button
              className="btn"
              style={{ fontSize: "12px" }}
              onClick={() => {
                corpusCancelled.current = true;
              }}
            >
              Stop
            </button>
          </>
        )}
        {corpusState.phase === "done" && (
          <span style={{ fontSize: "13px", color: "#2b8a3e" }}>
            ✓ Corpus synced — {corpusState.sent}
            {corpusState.total ? ` / ${corpusState.total}` : ""} athletes
            {corpusState.failures.length > 0 && `, ${corpusState.failures.length} failed`}
          </span>
        )}
        {corpusState.phase === "error" && (
          <span style={{ fontSize: "13px", color: "#c92a2a" }}>{corpusState.message}</span>
        )}
        {corpusState.phase === "idle" && (
          <span className="text-muted" style={{ fontSize: "12px" }}>
            Re-run after profile backfills or new program summaries. Idempotent — safe anytime.
          </span>
        )}
      </div>
      {(corpusState.phase === "done" || corpusState.phase === "running") &&
        corpusState.failures.length > 0 && (
          <div style={{ marginTop: "0.5rem" }}>
            {corpusState.failures.slice(0, 10).map((f, i) => (
              <p key={i} style={{ fontSize: "12px", color: "#c92a2a", margin: "2px 0" }}>
                {f}
              </p>
            ))}
            {corpusState.failures.length > 10 && (
              <p className="text-muted" style={{ fontSize: "12px" }}>
                …and {corpusState.failures.length - 10} more
              </p>
            )}
          </div>
        )}
    </div>
  );
}
