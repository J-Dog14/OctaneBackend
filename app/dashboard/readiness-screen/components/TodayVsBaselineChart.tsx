"use client";

import { BarChart, Bar, XAxis, YAxis, Cell, ReferenceLine, Tooltip, ResponsiveContainer } from "recharts";
import type { TodayVsBaselineEntry } from "../types";

type Props = { data: TodayVsBaselineEntry[] };

function flagColor(flag: string | null): string {
  if (flag === "rise")                 return "var(--accent-green, #3ecf8e)";
  if (flag === "drop")                 return "var(--accent-red, #f06a6a)";
  if (flag === "insufficient_history") return "rgba(255,255,255,0.15)";
  return "var(--accent-yellow, #e7b53c)";
}

function shortLabel(label: string): string {
  const parts = label.split(".");
  const col = parts[parts.length - 1]!;
  return col.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function TodayVsBaselineChart({ data }: Props) {
  const scored = data.filter((d) => d.z !== null);

  if (scored.length === 0) return (
    <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontSize: "0.8rem" }}>
      No baseline data
    </div>
  );

  // Sort ascending: worst (most negative) at top, best (most positive) at bottom
  const sorted = [...scored].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  const chartData = sorted.map((d) => ({ ...d, label: shortLabel(d.label) }));
  const height = Math.max(160, chartData.length * 28 + 48);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 40, left: 130, bottom: 4 }}>
        <XAxis
          type="number"
          domain={["dataMin - 0.3", "dataMax + 0.3"]}
          tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
          axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
          tickLine={false}
          tickCount={9}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={128}
        />
        <ReferenceLine x={0} stroke="rgba(255,255,255,0.2)" />
        <ReferenceLine x={0.6}  stroke="rgba(62,207,142,0.2)"  strokeDasharray="3 3" />
        <ReferenceLine x={-0.6} stroke="rgba(240,106,106,0.2)" strokeDasharray="3 3" />
        <Tooltip
          contentStyle={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.78rem" }}
          formatter={(val) => [(val as number)?.toFixed(3), "z-score"]}
          labelStyle={{ color: "rgba(255,255,255,0.55)" }}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
        />
        <Bar dataKey="z" radius={[0, 3, 3, 0]}>
          {chartData.map((entry, i) => (
            <Cell key={i} fill={flagColor(entry.flag)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
