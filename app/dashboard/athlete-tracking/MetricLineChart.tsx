"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export type LineDataPoint = {
  date: string;
  value: number | null;
};

type Props = {
  title: string;
  data: LineDataPoint[];
  unit?: string;
};

function formatDateLabel(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[parseInt(parts[1]!, 10) - 1] ?? "";
  const day = parseInt(parts[2]!, 10);
  return `${month} ${day}`;
}

export function MetricLineChart({ title, data, unit }: Props) {
  const validData = data.filter((d) => d.value !== null);
  const hasData = validData.length >= 1;

  const chartData = data.map((d) => ({ date: d.date, value: d.value, label: formatDateLabel(d.date) }));

  // Most recent date (last in ascending sorted array)
  const newestDate = validData.length > 0 ? validData[validData.length - 1]!.date : null;

  const tooltipFormatter = (value: number | undefined) => {
    if (value == null) return ["—", title];
    return [`${value}${unit ? ` ${unit}` : ""}`, title];
  };

  if (!hasData) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 130,
          color: "rgba(255,255,255,0.3)",
          fontSize: "0.78rem",
        }}
      >
        No data
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.4rem", color: "var(--text-primary)" }}>
        {title}
        {unit && (
          <span style={{ fontWeight: 400, color: "rgba(255,255,255,0.45)", marginLeft: "0.3rem" }}>({unit})</span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={chartData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }}
            axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={36}
            tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
          />
          <Tooltip
            contentStyle={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: "0.78rem",
              color: "var(--text-primary)",
            }}
            formatter={tooltipFormatter}
            labelStyle={{ color: "rgba(255,255,255,0.55)", marginBottom: "0.2rem" }}
            cursor={{ stroke: "rgba(255,255,255,0.15)" }}
          />
          <Line
            type="linear"
            dataKey="value"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, payload } = props;
              const isNewest = payload.date === newestDate;
              return (
                <circle
                  key={`dot-${payload.date}`}
                  cx={cx}
                  cy={cy}
                  r={isNewest ? 5 : 3}
                  fill={isNewest ? "var(--accent)" : "var(--bg-secondary)"}
                  stroke="var(--accent)"
                  strokeWidth={isNewest ? 0 : 2}
                />
              );
            }}
            activeDot={{ r: 5, fill: "var(--accent)", strokeWidth: 0 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
