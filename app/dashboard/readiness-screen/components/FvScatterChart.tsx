"use client";

import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { FvScatterPoint, PeerPoint } from "../types";

type Props = {
  scatter: FvScatterPoint[];
  peers:   PeerPoint[];
};

export function FvScatterChart({ scatter, peers }: Props) {
  const hasData = scatter.length > 0;
  if (!hasData && peers.length === 0) return (
    <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontSize: "0.8rem" }}>
      No F-V data
    </div>
  );

  const peerData = peers.map((p) => ({ x: p.force_at_pp, y: p.vel_at_pp }));
  const athleteData = scatter
    .filter((p) => p.force_at_pp !== null && p.vel_at_pp !== null)
    .map((p) => ({ x: p.force_at_pp as number, y: p.vel_at_pp as number, date: p.date }));

  return (
    <ResponsiveContainer width="100%" height={160}>
      <ScatterChart margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
        <XAxis
          type="number"
          dataKey="x"
          name="Force at PP"
          tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
          axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
          tickLine={false}
          label={{ value: "Force at PP (N)", position: "insideBottom", offset: -2, fontSize: 10, fill: "rgba(255,255,255,0.3)" }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Vel at PP"
          tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={36}
          label={{ value: "Vel (m/s)", angle: -90, position: "insideLeft", offset: 14, fontSize: 10, fill: "rgba(255,255,255,0.3)" }}
        />
        <Tooltip
          contentStyle={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.78rem" }}
          cursor={{ strokeDasharray: "3 3" }}
          formatter={(val, name) => [(val as number)?.toFixed(2), name as string]}
        />
        {/* Peer cloud */}
        <Scatter
          name="Peers"
          data={peerData}
          fill="rgba(255,255,255,0.1)"
          r={3}
        />
        {/* Athlete sessions */}
        <Scatter
          name="Athlete"
          data={athleteData}
          fill="var(--accent, #34a9e6)"
          r={6}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
