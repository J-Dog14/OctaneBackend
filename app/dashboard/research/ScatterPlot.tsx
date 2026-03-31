"use client";

import { useMemo } from "react";
import {
  ComposedChart,
  Scatter,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Text } from "@mantine/core";
import type { DataPoint } from "@/app/api/dashboard/research/data/route";
import type { StatisticsResult } from "@/lib/research/statistics";
import { generateTrendlinePoints } from "@/lib/research/statistics";

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  points: DataPoint[];
  xLabel: string;
  yLabel: string;
  trendlineMode: "linear" | "polynomial" | "none";
  statistics: StatisticsResult;
  colorByAgeGroup: boolean;
};

// ─── Colour palette ───────────────────────────────────────────────────────────

const AGE_GROUP_COLORS: Record<string, string> = {
  "Pro":         "#228be6",
  "College":     "#40c057",
  "High School": "#fd7e14",
  "Softball":    "#cc5de8",
};

const DEFAULT_COLORS = [
  "#228be6","#40c057","#fd7e14","#cc5de8","#e64980","#12b886","#fab005","#74c0fc",
];

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, xLabel, yLabel }: {
  active?: boolean;
  payload?: Array<{ payload: DataPoint & { __trendline?: boolean } }>;
  xLabel: string;
  yLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (d.__trendline) return null;
  return (
    <div style={{
      background: "var(--mantine-color-body)",
      border: "1px solid var(--mantine-color-default-border)",
      borderRadius: 8,
      padding: "8px 12px",
      fontSize: 12,
    }}>
      <strong>{d.athleteName}</strong>
      {d.ageGroup && <div style={{ color: "var(--mantine-color-dimmed)" }}>{d.ageGroup}</div>}
      <div>{xLabel}: <strong>{typeof d.x === "number" ? d.x.toFixed(3) : d.x}</strong></div>
      <div>{yLabel}: <strong>{typeof d.y === "number" ? d.y.toFixed(3) : d.y}</strong></div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ScatterPlot({ points, xLabel, yLabel, trendlineMode, statistics, colorByAgeGroup }: Props) {
  // Group points by athlete (for coloring each person) or by age group
  const groups = useMemo(() => {
    if (colorByAgeGroup) {
      const map = new Map<string, DataPoint[]>();
      for (const p of points) {
        const key = p.ageGroup ?? "Unknown";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(p);
      }
      return [...map.entries()].map(([label, pts], i) => ({
        label,
        pts,
        color: AGE_GROUP_COLORS[label] ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      }));
    } else {
      // Color by individual athlete (up to 20 distinct colors)
      const map = new Map<string, DataPoint[]>();
      for (const p of points) {
        if (!map.has(p.athleteUuid)) map.set(p.athleteUuid, []);
        map.get(p.athleteUuid)!.push(p);
      }
      return [...map.entries()].map(([, pts], i) => ({
        label: pts[0].athleteName,
        pts,
        color: DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      }));
    }
  }, [points, colorByAgeGroup]);

  // Trendline
  const trendline = useMemo(() => {
    if (trendlineMode === "none") return [];
    const xs = points.map((p) => p.x);
    const tpts = generateTrendlinePoints(
      xs,
      statistics.regression,
      statistics.polyRegression,
      trendlineMode === "polynomial" ? "polynomial" : "linear",
    );
    return tpts.map((p) => ({ ...p, __trendline: true }));
  }, [points, trendlineMode, statistics]);

  if (points.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400 }}>
        <Text c="dimmed" size="sm">No data points found with both X and Y values.</Text>
      </div>
    );
  }

  // Axis domain padding
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xPad = (Math.max(...xs) - Math.min(...xs)) * 0.05 || 1;
  const yPad = (Math.max(...ys) - Math.min(...ys)) * 0.05 || 1;
  const xDomain: [number, number] = [Math.min(...xs) - xPad, Math.max(...xs) + xPad];
  const yDomain: [number, number] = [Math.min(...ys) - yPad, Math.max(...ys) + yPad];

  const showLegend = groups.length <= 15;

  return (
    <ResponsiveContainer width="100%" height={480}>
      <ComposedChart margin={{ top: 20, right: 30, bottom: 60, left: 60 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-default-border)" />
        <XAxis
          type="number"
          dataKey="x"
          name={xLabel}
          domain={xDomain}
          tickCount={8}
          label={{ value: xLabel, position: "insideBottom", offset: -45, fontSize: 12 }}
          tickFormatter={(v: number) => v.toFixed(2)}
          style={{ fontSize: 11 }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={yLabel}
          domain={yDomain}
          tickCount={8}
          label={{ value: yLabel, angle: -90, position: "insideLeft", offset: 15, fontSize: 12 }}
          tickFormatter={(v: number) => v.toFixed(2)}
          style={{ fontSize: 11 }}
        />
        <Tooltip
          content={<CustomTooltip xLabel={xLabel} yLabel={yLabel} />}
          cursor={{ strokeDasharray: "3 3" }}
        />
        {showLegend && (
          <Legend
            wrapperStyle={{ paddingTop: 8, fontSize: 12 }}
            verticalAlign="top"
          />
        )}

        {/* Data points — one Scatter series per group */}
        {groups.map((g) => (
          <Scatter
            key={g.label}
            name={g.label}
            data={g.pts}
            fill={g.color}
            fillOpacity={0.8}
            r={5}
          />
        ))}

        {/* Trendline */}
        {trendline.length > 0 && (
          <Line
            data={trendline}
            dataKey="y"
            dot={false}
            activeDot={false}
            stroke="#e64980"
            strokeWidth={2}
            strokeDasharray={trendlineMode === "polynomial" ? "0" : "6 3"}
            name={trendlineMode === "polynomial" ? "Polynomial fit" : "Linear fit"}
            legendType="line"
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
