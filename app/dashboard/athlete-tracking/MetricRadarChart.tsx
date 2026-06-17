"use client";

import { useState, useEffect } from "react";
import {
  Radar,
  RadarChart as RechartsRadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";

export type RadarMetric = {
  subject: string;
  value: number;
  fullMark: number;
  displayValue?: string;
};

/** Max 6 series: Octane blue → Dusty red → purple → green → yellow → orange */
export const SERIES_COLORS = [
  "#2c99d4", // Octane blue (--accent)
  "#d62728", // Dusty red (--accent-secondary)
  "#9467bd", // purple
  "#2ca02c", // green
  "#e6c200", // yellow
  "#ff7f0e", // orange
];

export type RadarDataSeries = {
  name: string;
  data: RadarMetric[];
  color: string;
};

type MetricRadarChartProps = {
  /** Single series (used when only one athlete/date). */
  data?: RadarMetric[];
  /** Multiple series (e.g. multiple athletes or dates); when set, overrides data. */
  dataSeries?: RadarDataSeries[];
  title?: string;
  /** Optional: show value in tooltip for single-series (e.g. raw value + unit) */
  valueLabel?: string;
};

function mergeSeriesIntoChartData(series: RadarDataSeries[]): {
  data: Record<string, number | string>[];
  keys: string[];
} {
  const subjectSet = new Set<string>();
  for (const s of series) {
    for (const point of s.data) subjectSet.add(point.subject);
  }
  const subjects = Array.from(subjectSet);
  const valueBySubject = new Map<string, Map<number, number>>();
  for (let i = 0; i < series.length; i++) {
    const bySubj = new Map<string, number>();
    for (const point of series[i]!.data) bySubj.set(point.subject, point.value);
    for (const subj of subjects) {
      if (!valueBySubject.has(subj)) valueBySubject.set(subj, new Map());
      valueBySubject.get(subj)!.set(i, bySubj.get(subj) ?? 0);
    }
  }
  const keys = series.map((_, i) => `series_${i}`);
  const data = subjects.map((subject) => {
    const row: Record<string, number | string> = { subject };
    const vals = valueBySubject.get(subject)!;
    keys.forEach((key, i) => {
      row[key] = vals.get(i) ?? 0;
    });
    return row;
  });
  return { data, keys };
}

/** Break a label string into lines of at most maxChars characters, splitting on word boundaries. */
function wrapLabel(text: string, maxChars = 14): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Custom tick for PolarAngleAxis that renders wrapped multi-line labels. */
function RadarTickLabel(props: {
  x?: number | string;
  y?: number | string;
  textAnchor?: "start" | "middle" | "end" | "inherit";
  payload?: { value: string };
  [key: string]: unknown;
}) {
  const x = typeof props.x === "string" ? parseFloat(props.x) : (props.x ?? 0);
  const y = typeof props.y === "string" ? parseFloat(props.y) : (props.y ?? 0);
  const textAnchor = props.textAnchor ?? "middle";
  const { payload } = props;
  if (!payload?.value) return null;

  const lines = wrapLabel(payload.value, 14);
  const lineHeight = 13;
  // Centre the block of lines vertically around y
  const totalHeight = lines.length * lineHeight;
  const startY = y - (totalHeight - lineHeight) / 2;

  return (
    <text
      x={x}
      y={startY}
      textAnchor={textAnchor}
      fill="var(--text-secondary)"
      fontSize={11}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : lineHeight}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

export function MetricRadarChart({
  data = [],
  dataSeries,
  title,
  valueLabel,
}: MetricRadarChartProps) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const handler = () => setIsMobile(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const chartHeight = isMobile ? 260 : 360;
  const chartMargin = isMobile
    ? { top: 15, right: 20, bottom: 15, left: 20 }
    : { top: 30, right: 60, bottom: 30, left: 60 };

  const useMulti = dataSeries && dataSeries.length > 0;
  const singleData = useMulti ? [] : data;
  const hasSingle = singleData.length > 0;
  const { data: mergedData, keys } = useMulti
    ? mergeSeriesIntoChartData(dataSeries!)
    : { data: [] as Record<string, number | string>[], keys: [] as string[] };
  const hasMulti = useMulti && mergedData.length > 0;

  if (!hasSingle && !hasMulti) {
    return (
      <div className="card" style={{ minHeight: chartHeight }}>
        {title && (
          <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>{title}</h3>
        )}
        <p className="text-muted">No metric data to display.</p>
      </div>
    );
  }

  const chartData = useMulti ? mergedData : singleData;

  return (
    <div className="card" style={{ minHeight: chartHeight }}>
      {title && (
        <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={chartHeight}>
        <RechartsRadarChart
          data={chartData}
          margin={chartMargin}
        >
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis
            dataKey="subject"
            tick={RadarTickLabel}
            tickLine={{ stroke: "var(--border)" }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fill: "var(--text-muted)", fontSize: 10 }}
            tickCount={6}
          />
          {useMulti
            ? dataSeries!.slice(0, SERIES_COLORS.length).map((s, i) => (
                <Radar
                  key={s.name}
                  name={s.name}
                  dataKey={keys[i]!}
                  stroke={s.color}
                  fill={s.color}
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
              ))
            : (
              <Radar
                name={valueLabel ?? "Percentile"}
                dataKey="value"
                stroke="var(--accent)"
                fill="var(--accent)"
                fillOpacity={0.3}
                strokeWidth={2}
              />
            )}
          <Tooltip
            contentStyle={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
            labelStyle={{ color: "var(--text-primary)" }}
            formatter={(value, name, props) => {
              const payload = props?.payload as { displayValue?: string } | undefined;
              const disp = payload?.displayValue;
              const val = value != null ? Number(value).toFixed(0) : "—";
              return [disp ?? `${val}th %ile`, name ?? "Percentile"];
            }}
          />
          <Legend />
        </RechartsRadarChart>
      </ResponsiveContainer>
    </div>
  );
}
