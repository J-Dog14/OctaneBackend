"use client";

import type React from "react";
import { formatMetricDisplayName } from "@/lib/athlete-tracking/displayNames";

type MetricSummary = {
  name: string;
  category: string;
  percentile: number | null;
};

type HighlightItem = {
  domainLabel: string;
  domainId: string;
  metric: MetricSummary;
};

interface Props {
  highlights: HighlightItem[];
  lowlights: HighlightItem[];
}

function getPercentileStyle(percentile: number | null): React.CSSProperties | undefined {
  if (percentile == null) return undefined;
  if (percentile > 85) return { color: "#16a34a" };
  if (percentile > 60) return { color: "#4ade80" };
  if (percentile > 40) return { color: "var(--text-primary)" };
  if (percentile > 15) return { color: "#f59e0b" };
  return { color: "var(--accent-secondary)" };
}

export function HighlightsLowlightsCard({ highlights, lowlights }: Props) {
  return (
    <div className="card" style={{ marginBottom: "1.5rem" }}>
      <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>Highlights vs Lowlights</h3>
      {highlights.length === 0 && lowlights.length === 0 ? (
        <p className="text-muted">No domain data for this athlete.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
          <div>
            <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.9rem", color: "var(--accent)" }}>
              Highlights
            </h4>
            <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
              {highlights.map(({ domainLabel, domainId, metric }, i) => (
                <li
                  key={`high-${i}-${domainLabel}-${metric.name}`}
                  style={{ marginBottom: "0.35rem" }}
                >
                  {formatMetricDisplayName(metric.name, metric.category, domainId)}{" "}
                  <span className="text-muted">({domainLabel})</span>{" "}
                  <span style={getPercentileStyle(metric.percentile)}>
                    {Math.round(metric.percentile ?? 0)}th %ile
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4
              style={{ margin: "0 0 0.5rem", fontSize: "0.9rem", color: "var(--accent-secondary)" }}
            >
              Lowlights
            </h4>
            <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
              {lowlights.map(({ domainLabel, domainId, metric }, i) => (
                <li
                  key={`low-${i}-${domainLabel}-${metric.name}`}
                  style={{ marginBottom: "0.35rem" }}
                >
                  {formatMetricDisplayName(metric.name, metric.category, domainId)}{" "}
                  <span className="text-muted">({domainLabel})</span>{" "}
                  <span style={getPercentileStyle(metric.percentile)}>
                    {Math.round(metric.percentile ?? 0)}th %ile
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
