"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Text, Stack } from "@mantine/core";
import type { TimeSeriesSeries } from "@/app/api/dashboard/research/timeseries/route";

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  series: TimeSeriesSeries[];
  metricNames: string[];
  referenceFrame?: number;
};

// ─── Colour palettes ──────────────────────────────────────────────────────────

const METRIC_COLORS = [
  "#228be6", // blue
  "#e64980", // pink
  "#40c057", // green
  "#fd7e14", // orange
  "#cc5de8", // purple
  "#12b886", // teal
  "#fab005", // yellow
  "#74c0fc", // light blue
];

// ─── Merge series into Recharts row format ────────────────────────────────────

type ChartRow = { frame: number; [key: string]: number | undefined };

function buildChartData(series: TimeSeriesSeries[]): ChartRow[] {
  const framesSet = new Set<number>();
  for (const s of series) {
    for (const pt of s.data) framesSet.add(pt.frame);
  }
  const frames = [...framesSet].sort((a, b) => a - b);

  const lookup = new Map<string, Map<number, number>>();
  for (const s of series) {
    const m = new Map<number, number>();
    for (const pt of s.data) m.set(pt.frame, pt.value);
    lookup.set(s.seriesKey, m);
  }

  return frames.map((frame) => {
    const row: ChartRow = { frame };
    for (const s of series) {
      row[s.seriesKey] = lookup.get(s.seriesKey)?.get(frame);
    }
    return row;
  });
}

// ─── Assign colours ───────────────────────────────────────────────────────────

function buildColorMap(
  series: TimeSeriesSeries[],
  metricNames: string[],
): Map<string, string> {
  const colorMap = new Map<string, string>();
  const multiMetric = metricNames.length > 1;

  if (multiMetric) {
    const metricIdx = new Map(metricNames.map((m, i) => [m, i]));
    for (const s of series) {
      const idx = metricIdx.get(s.metricName) ?? 0;
      colorMap.set(s.seriesKey, METRIC_COLORS[idx % METRIC_COLORS.length]);
    }
  } else {
    series.forEach((s, i) => {
      colorMap.set(s.seriesKey, METRIC_COLORS[i % METRIC_COLORS.length]);
    });
  }
  return colorMap;
}

// ─── Single chart ─────────────────────────────────────────────────────────────

function SingleChart({
  series,
  metricNames,
  referenceFrame,
  yAxisLabel,
}: {
  series: TimeSeriesSeries[];
  metricNames: string[];
  referenceFrame?: number;
  yAxisLabel: string;
}) {
  const data      = buildChartData(series);
  const colorMap  = buildColorMap(series, metricNames);
  const showLegend = series.length <= 20;

  const allValues = series.flatMap((s) => s.data.map((pt) => pt.value));
  const yMin = Math.min(...allValues);
  const yMax = Math.max(...allValues);
  const yPad = (yMax - yMin) * 0.05 || 1;

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 10, right: 30, bottom: 50, left: 70 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-default-border)" />
        <XAxis
          dataKey="frame"
          type="number"
          label={{ value: "Frame", position: "insideBottom", offset: -35, fontSize: 12 }}
          tickCount={12}
          style={{ fontSize: 11 }}
        />
        <YAxis
          domain={[yMin - yPad, yMax + yPad]}
          tickFormatter={(v: number) => v.toFixed(2)}
          label={{
            value: yAxisLabel,
            angle: -90,
            position: "insideLeft",
            offset: 15,
            fontSize: 11,
            style: { textAnchor: "middle" },
          }}
          style={{ fontSize: 11 }}
        />
        <Tooltip
          formatter={(value: number | undefined, name: string | undefined) => [
            typeof value === "number" ? value.toFixed(4) : (value ?? ""),
            name ?? "",
          ]}
          labelFormatter={(label: unknown) => `Frame ${label}`}
          contentStyle={{
            background: "var(--mantine-color-body)",
            border: "1px solid var(--mantine-color-default-border)",
            borderRadius: 8,
            fontSize: 12,
            maxHeight: 300,
            overflowY: "auto",
          }}
        />
        {showLegend && (
          <Legend wrapperStyle={{ paddingTop: 4, fontSize: 11 }} verticalAlign="top" />
        )}
        {referenceFrame !== undefined && (
          <ReferenceLine
            x={referenceFrame}
            stroke="#e64980"
            strokeDasharray="5 5"
            strokeWidth={1.5}
            label={{ value: `Frame ${referenceFrame}`, position: "insideTopLeft", fontSize: 10, fill: "#e64980" }}
          />
        )}
        {series.map((s) => (
          <Line
            key={s.seriesKey}
            type="monotone"
            dataKey={s.seriesKey}
            name={s.seriesKey}
            stroke={colorMap.get(s.seriesKey) ?? "#888"}
            strokeWidth={metricNames.length > 1 ? 2 : 1.5}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TimeSeriesPlot({ series, metricNames, referenceFrame }: Props) {
  if (series.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400 }}>
        <Text c="dimmed" size="sm">No data found. Try different settings.</Text>
      </div>
    );
  }

  const isVector = series.some((s) => s.component !== null);

  if (!isVector) {
    // Scalar data — single chart
    const yAxisLabel = metricNames.length === 1 ? metricNames[0] : "Value";
    return (
      <SingleChart
        series={series}
        metricNames={metricNames}
        referenceFrame={referenceFrame}
        yAxisLabel={yAxisLabel}
      />
    );
  }

  // Vector data — one chart per component (x, y, z)
  const COMPONENTS: Array<"x" | "y" | "z"> = ["x", "y", "z"];
  const COMPONENT_LABELS: Record<"x" | "y" | "z", string> = { x: "X", y: "Y", z: "Z" };

  return (
    <Stack gap="xs">
      {COMPONENTS.map((comp) => {
        const compSeries = series.filter((s) => s.component === comp);
        if (compSeries.length === 0) return null;
        const yAxisLabel = metricNames.length === 1
          ? `${metricNames[0]} (${COMPONENT_LABELS[comp]})`
          : `${COMPONENT_LABELS[comp]}`;
        return (
          <div key={comp}>
            <Text size="xs" fw={600} c="dimmed" mb={4} ml={70}>
              {COMPONENT_LABELS[comp]}
            </Text>
            <SingleChart
              series={compSeries}
              metricNames={metricNames}
              referenceFrame={referenceFrame}
              yAxisLabel={yAxisLabel}
            />
          </div>
        );
      })}
    </Stack>
  );
}
