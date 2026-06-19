"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";
import type { IntraSessionEntry } from "../types";

type Props = {
  cmj: IntraSessionEntry[];
  ppu: IntraSessionEntry[];
};

const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(d: string): string {
  const p = d.split("-");
  if (p.length !== 3) return d;
  return `${months[parseInt(p[1]!, 10) - 1]} ${parseInt(p[2]!, 10)}`;
}

export function TrialConsistencyChart({ cmj, ppu }: Props) {
  // Build chart rows: one per session date, with T1/T2 jump heights for CMJ and PPU
  const allDates = Array.from(
    new Set([...cmj.map((s) => s.date), ...ppu.map((s) => s.date)])
  ).sort().slice(-20);

  const cmjByDate = new Map(cmj.map((s) => [s.date, s.trials]));
  const ppuByDate = new Map(ppu.map((s) => [s.date, s.trials]));

  const chartData = allDates.map((date) => {
    const cTrials = cmjByDate.get(date) ?? [];
    const pTrials = ppuByDate.get(date) ?? [];
    return {
      label:     fmtDate(date),
      "CMJ T1":  cTrials[0]?.jump_height ?? null,
      "CMJ T2":  cTrials[1]?.jump_height ?? null,
      "PPU T1":  pTrials[0]?.jump_height ?? null,
      "PPU T2":  pTrials[1]?.jump_height ?? null,
    };
  });

  const hasAny = chartData.some((d) => d["CMJ T1"] !== null || d["PPU T1"] !== null);
  if (!hasAny) return (
    <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontSize: "0.8rem" }}>
      No trial data
    </div>
  );

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={chartData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9 }} axisLine={{ stroke: "rgba(255,255,255,0.12)" }} tickLine={false} />
        <YAxis tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
        <Tooltip
          contentStyle={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.78rem" }}
          labelStyle={{ color: "rgba(255,255,255,0.55)" }}
        />
        <Legend wrapperStyle={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.5)" }} />
        <Bar dataKey="CMJ T1" fill="var(--accent, #34a9e6)"         radius={[2,2,0,0]} />
        <Bar dataKey="CMJ T2" fill="rgba(52,169,230,0.45)"          radius={[2,2,0,0]} />
        <Bar dataKey="PPU T1" fill="var(--accent-green, #3ecf8e)"   radius={[2,2,0,0]} />
        <Bar dataKey="PPU T2" fill="rgba(62,207,142,0.45)"          radius={[2,2,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
