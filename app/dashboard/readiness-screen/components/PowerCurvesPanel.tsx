"use client";

import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";
import type { PowerCurvePoint } from "../types";

type Props = {
  cmj: PowerCurvePoint[];
  ppu: PowerCurvePoint[];
};

const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(d: string): string {
  const p = d.split("-");
  if (p.length !== 3) return d;
  return `${months[parseInt(p[1]!, 10) - 1]} ${parseInt(p[2]!, 10)}`;
}

function PowerChart({ data, title }: { data: PowerCurvePoint[]; title: string }) {
  if (data.length === 0) return (
    <div style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontSize: "0.8rem" }}>
      No {title} power data
    </div>
  );

  const chartData = data.map((d) => ({ ...d, label: fmtDate(d.date) }));

  return (
    <div>
      <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: 1 }}>{title}</p>
      <ResponsiveContainer width="100%" height={150}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 40, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9 }} axisLine={{ stroke: "rgba(255,255,255,0.12)" }} tickLine={false} />
          <YAxis yAxisId="left"  tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9 }} axisLine={false} tickLine={false} width={38}
                 tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(v)} />
          <YAxis yAxisId="right" orientation="right" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9 }} axisLine={false} tickLine={false} width={34}
                 tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
          <Tooltip
            contentStyle={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.76rem" }}
            labelStyle={{ color: "rgba(255,255,255,0.55)" }}
          />
          <Legend wrapperStyle={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.5)" }} />
          <Line yAxisId="left"  type="linear" dataKey="peak_power_w" name="Peak Power (W)"  stroke="var(--accent, #34a9e6)"         strokeWidth={2} dot={false} connectNulls={false} />
          <Line yAxisId="right" type="linear" dataKey="rpd_max"      name="RPD Max (W/s)"   stroke="var(--accent-green, #3ecf8e)"   strokeWidth={1.5} dot={false} connectNulls={false} />
          <Line yAxisId="right" type="linear" dataKey="rise_slope"   name="Rise Slope (W/s)" stroke="var(--accent-yellow, #e7b53c)"  strokeWidth={1.5} dot={false} connectNulls={false} strokeDasharray="4 2" />
          <Line yAxisId="left"  type="linear" dataKey="auc_j"        name="AUC (J)"          stroke="rgba(180,120,255,0.8)"           strokeWidth={1.5} dot={false} connectNulls={false} strokeDasharray="2 2" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PowerCurvesPanel({ cmj, ppu }: Props) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
      <PowerChart data={cmj} title="CMJ" />
      <PowerChart data={ppu} title="PPU" />
    </div>
  );
}
