"use client";

import { MetricLineChart } from "@/app/dashboard/athlete-tracking/MetricLineChart";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { IsoPayload, GripPoint } from "../types";

type Props = {
  iso:        IsoPayload;
  grip:       GripPoint[];
  showLegacy: boolean;
};

export function IsoGripSection({ iso, grip, showLegacy }: Props) {
  const yData    = iso.Y.data.map((d) => ({ date: d.date, value: d.max_force }));
  const ir90Data = iso.IR90.data.map((d) => ({ date: d.date, value: d.max_force }));
  const iData    = iso.I.data.map((d) => ({ date: d.date, value: d.max_force }));
  const tData    = iso.T.data.map((d) => ({ date: d.date, value: d.max_force }));

  const gripLeft  = grip.map((d) => ({ date: d.date, value: d.left_kg }));
  const gripRight = grip.map((d) => ({ date: d.date, value: d.right_kg }));
  const gripMax   = grip.map((d) => ({ date: d.date, value: d.max_kg }));

  const asym = grip
    .filter((d) => d.left_kg !== null && d.right_kg !== null)
    .map((d) => ({ x: d.left_kg as number, y: d.right_kg as number, asym: d.asymmetry_pct }));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
      {/* ISO column */}
      <div>
        <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
          Isometric — Max Force
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <MetricLineChart title="Y (scap)" data={yData}    unit="N" />
          <MetricLineChart title="IR90"     data={ir90Data} unit="N" />
          {showLegacy && <MetricLineChart title="I (legacy)" data={iData} unit="N" />}
          {showLegacy && <MetricLineChart title="T (legacy)" data={tData} unit="N" />}
        </div>
      </div>

      {/* Grip column */}
      <div>
        <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
          Grip Strength
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <MetricLineChart title="Left"  data={gripLeft}  unit="kg" />
          <MetricLineChart title="Right" data={gripRight} unit="kg" />
          <MetricLineChart title="Max"   data={gripMax}   unit="kg" />
        </div>
        {/* L vs R scatter */}
        {asym.length > 0 && (
          <>
            <p style={{ fontSize: "0.73rem", color: "rgba(255,255,255,0.35)", marginBottom: "0.3rem" }}>Left vs Right</p>
            <ResponsiveContainer width="100%" height={120}>
              <ScatterChart margin={{ top: 4, right: 12, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
                <XAxis type="number" dataKey="x" name="Left" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9 }} axisLine={false} tickLine={false} label={{ value: "Left", position: "insideBottom", fontSize: 9, fill: "rgba(255,255,255,0.3)", offset: -2 }} />
                <YAxis type="number" dataKey="y" name="Right" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9 }} axisLine={false} tickLine={false} width={28} />
                <Tooltip
                  contentStyle={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.76rem" }}
                  formatter={(val, name) => [`${(val as number)?.toFixed(1)} kg`, name as string]}
                />
                <Scatter data={asym} fill="var(--accent, #34a9e6)" r={4} />
              </ScatterChart>
            </ResponsiveContainer>
          </>
        )}
      </div>
    </div>
  );
}
