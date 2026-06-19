"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from "recharts";
import type { ScoreHistoryEntry } from "../types";

type Props = { data: ScoreHistoryEntry[] };

const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(d: string): string {
  const p = d.split("-");
  if (p.length !== 3) return d;
  return `${months[parseInt(p[1]!, 10) - 1]} ${parseInt(p[2]!, 10)}`;
}

function bandDot(entry: ScoreHistoryEntry, cx: number, cy: number) {
  const color =
    entry.band === "READY"    ? "var(--accent-green, #3ecf8e)" :
    entry.band === "FATIGUED" ? "var(--accent-red, #f06a6a)"   :
                                "var(--accent-yellow, #e7b53c)";
  return <circle key={entry.date} cx={cx} cy={cy} r={4} fill={color} stroke="none" />;
}

export function ScoreHistoryChart({ data }: Props) {
  if (data.length === 0) return (
    <div style={{ height: 140, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontSize: "0.8rem" }}>
      No score history
    </div>
  );

  const chartData = data.map((d) => ({ ...d, label: fmtDate(d.date) }));

  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={chartData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
        <ReferenceLine y={60} stroke="rgba(62,207,142,0.25)" strokeDasharray="4 3" />
        <ReferenceLine y={40} stroke="rgba(240,106,106,0.25)" strokeDasharray="4 3" />
        <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} axisLine={{ stroke: "rgba(255,255,255,0.12)" }} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
        <Tooltip
          contentStyle={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.78rem" }}
          formatter={(val) => [(val as number)?.toFixed(1), "Score"]}
          labelStyle={{ color: "rgba(255,255,255,0.55)" }}
        />
        <Line
          type="linear"
          dataKey="composite_score"
          stroke="var(--accent)"
          strokeWidth={2}
          dot={(props) => {
            const { cx, cy, payload } = props;
            return bandDot(payload as ScoreHistoryEntry, cx as number, cy as number);
          }}
          activeDot={{ r: 5, strokeWidth: 0 }}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
