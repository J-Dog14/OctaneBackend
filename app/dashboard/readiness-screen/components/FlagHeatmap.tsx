"use client";

import type { FlagHeatmap as FlagHeatmapType } from "../types";

type Props = { data: FlagHeatmapType };

const FLAG_COLORS: Record<string, string> = {
  rise:                 "#3ecf8e",
  drop:                 "#f06a6a",
  stable:               "#2c99d4",
  insufficient_history: "#243044",
};

function shortMetricLabel(label: string): string {
  const parts = label.split(".");
  const col = parts[parts.length - 1]!;
  return col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function shortDate(d: string): string {
  const p = d.split("-");
  if (p.length !== 3) return d;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(p[1]!, 10) - 1]} ${parseInt(p[2]!, 10)}`;
}

export function FlagHeatmap({ data }: Props) {
  const { dates, metrics, cells } = data;

  if (dates.length === 0 || metrics.length === 0) return (
    <div className="text-muted" style={{ fontSize: "0.8rem" }}>No flag history yet.</div>
  );

  return (
    <>
      <div className="heatmap-wrap">
        <table className="heatmap-table">
          <thead>
            <tr>
              <th className="heatmap-metric-label" />
              {dates.map((d) => (
                <th key={d} className="heatmap-date">{shortDate(d)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric, mi) => (
              <tr key={metric}>
                <td className="heatmap-metric-label">{shortMetricLabel(metric)}</td>
                {dates.map((_, di) => {
                  const flag = cells[di]?.[mi] ?? null;
                  const bg   = flag ? (FLAG_COLORS[flag] ?? "var(--bg-tertiary)") : "transparent";
                  return (
                    <td
                      key={di}
                      className="heatmap-cell"
                      style={{ background: bg }}
                      title={flag ?? "no data"}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="heatmap-legend">
        {[
          { label: "Rise",         color: "#3ecf8e" },
          { label: "Drop",         color: "#f06a6a" },
          { label: "Stable",       color: "#2c99d4" },
          { label: "Insufficient", color: "#243044" },
        ].map(({ label, color }) => (
          <span key={label} className="heatmap-legend-item">
            <span className="heatmap-legend-swatch" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </>
  );
}
