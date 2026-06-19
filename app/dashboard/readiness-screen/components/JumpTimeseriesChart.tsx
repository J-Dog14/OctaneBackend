"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";
import type { JumpTimeseriesPoint } from "../types";

type Props = {
  data: JumpTimeseriesPoint[];
  kind: "cmj" | "ppu";
};

const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(d: string): string {
  const p = d.split("-");
  if (p.length !== 3) return d;
  return `${months[parseInt(p[1]!, 10) - 1]} ${parseInt(p[2]!, 10)}`;
}

export function JumpTimeseriesChart({ data, kind }: Props) {
  if (data.length === 0) return (
    <div style={{ height: 140, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontSize: "0.8rem" }}>
      No {kind.toUpperCase()} data
    </div>
  );

  const chartData = data.map((d) => ({ ...d, label: fmtDate(d.date) }));

  return (
    <ResponsiveContainer width="100%" height={150}>
      <LineChart data={chartData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} axisLine={{ stroke: "rgba(255,255,255,0.12)" }} tickLine={false} />
        <YAxis yAxisId="left" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
        <YAxis yAxisId="right" orientation="right" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
        <Tooltip
          contentStyle={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.78rem" }}
          labelStyle={{ color: "rgba(255,255,255,0.55)" }}
        />
        <Legend wrapperStyle={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.5)" }} />
        <Line yAxisId="left" type="linear" dataKey="jump_height" name="Jump Ht (in)" stroke="var(--accent, #34a9e6)" strokeWidth={2} dot={{ r: 3, fill: "var(--accent, #34a9e6)", strokeWidth: 0 }} connectNulls={false} />
        <Line yAxisId="right" type="linear" dataKey="pp_w_per_kg" name="PP W/kg" stroke="var(--accent-green, #3ecf8e)" strokeWidth={2} dot={{ r: 3, fill: "var(--accent-green, #3ecf8e)", strokeWidth: 0 }} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
