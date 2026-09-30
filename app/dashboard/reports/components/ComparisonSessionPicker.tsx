"use client";

import { useMemo } from "react";
import {
  MAX_COMPARISON_SESSIONS,
  MIN_COMPARISON_SESSIONS,
  MOVEMENT_ORDER,
  SESSION_COLORS,
} from "@/app/dashboard/reports/constants";
import type { SessionDetail } from "@/hooks/useSessionDates";

const formatSessionDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

interface Props {
  sessions: SessionDetail[];
  /** Selected dates in chronological order (oldest first). */
  comparisonDates: string[];
  toggleDate: (date: string) => void;
  resetToDefault: () => void;
  selectAllAvailable: () => void;
}

/**
 * Multi-select session picker for the comparison report.
 *
 * Each selected chip is swatched in the same color that session's dots take
 * on the PDF, so the picker and the report share one visual language. The
 * two most recent sessions come pre-selected — the common case — and every
 * other session stays one click away, up to the report's four-session cap.
 */
export function ComparisonSessionPicker({
  sessions,
  comparisonDates,
  toggleDate,
  resetToDefault,
  selectAllAvailable,
}: Props) {
  const selectedSet = useMemo(() => new Set(comparisonDates), [comparisonDates]);

  // Which movements are present in every selected session, and which are
  // present in only some. A movement in the gap renders on its page using
  // whichever sessions have it, so this is a note rather than an error.
  const movementGap = useMemo(() => {
    const picked = sessions.filter((s) => selectedSet.has(s.date));
    if (picked.length < 2) return [];
    const counts = new Map<string, number>();
    for (const s of picked) {
      for (const m of s.movements) counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    return MOVEMENT_ORDER.filter((m) => {
      const n = counts.get(m) ?? 0;
      return n > 0 && n < picked.length;
    });
  }, [sessions, selectedSet]);

  const enoughSessions = sessions.length >= MIN_COMPARISON_SESSIONS;

  if (!enoughSessions) {
    return (
      <div style={{ marginBottom: "1.25rem" }}>
        <Label />
        <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          This athlete only has {sessions.length} athletic screen
          {sessions.length === 1 ? "" : "s"} on file. A comparison needs at least{" "}
          {MIN_COMPARISON_SESSIONS}.
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <Label />

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
        {sessions.map((session) => {
          const selected = selectedSet.has(session.date);
          // Color by chronological position among the selected sessions,
          // matching SESSION_COLORS on the report itself.
          const order = comparisonDates.indexOf(session.date);
          const swatch =
            order >= 0 ? SESSION_COLORS[Math.min(order, SESSION_COLORS.length - 1)] : undefined;

          return (
            <button
              key={session.date}
              type="button"
              className="btn-ghost"
              aria-pressed={selected}
              onClick={() => toggleDate(session.date)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "7px 14px",
                borderRadius: 6,
                border: `1px solid ${selected ? swatch ?? "var(--accent)" : "var(--border)"}`,
                background: selected ? "var(--accent-muted)" : "var(--bg-tertiary)",
                color: selected ? "var(--text-primary)" : "var(--text-secondary)",
                fontWeight: selected ? 600 : 400,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: selected ? swatch : "transparent",
                  border: `1px solid ${selected ? swatch : "var(--border)"}`,
                }}
              />
              <span>{formatSessionDate(session.date)}</span>
              {session.movements.length > 0 && (
                <span
                  style={{
                    fontSize: "0.7rem",
                    letterSpacing: "0.03em",
                    color: "var(--text-secondary)",
                    fontWeight: 400,
                  }}
                >
                  {MOVEMENT_ORDER.filter((m) => session.movements.includes(m)).join(" · ")}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          fontSize: "0.8rem",
          color: "var(--text-secondary)",
        }}
      >
        <span>
          Comparing {comparisonDates.length} of {sessions.length} sessions
          {comparisonDates.length >= MAX_COMPARISON_SESSIONS &&
            ` (max ${MAX_COMPARISON_SESSIONS})`}
        </span>
        <button
          type="button"
          className="btn-ghost"
          onClick={resetToDefault}
          style={{ padding: "2px 8px", fontSize: "0.8rem" }}
        >
          Last two
        </button>
        {sessions.length > MIN_COMPARISON_SESSIONS && (
          <button
            type="button"
            className="btn-ghost"
            onClick={selectAllAvailable}
            style={{ padding: "2px 8px", fontSize: "0.8rem" }}
          >
            Most recent {Math.min(sessions.length, MAX_COMPARISON_SESSIONS)}
          </button>
        )}
      </div>

      {movementGap.length > 0 && (
        <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.5rem" }}>
          {movementGap.join(", ")} {movementGap.length === 1 ? "is" : "are"} missing from at least
          one selected session — {movementGap.length === 1 ? "that page" : "those pages"} will only
          plot the sessions that have it.
        </p>
      )}
    </div>
  );
}

function Label() {
  return (
    <label
      style={{ display: "block", fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}
    >
      Sessions to Compare
    </label>
  );
}
