"use client";

import { MetricLineChart } from "@/app/dashboard/athlete-tracking/MetricLineChart";
import type { MovementStrategyPoint } from "../types";

type Props = {
  data: MovementStrategyPoint[];
  kind: "cmj" | "ppu";
};

type Panel = { title: string; field: keyof MovementStrategyPoint; unit?: string };

const CMJ_PANELS: Panel[] = [
  { title: "mRSI",             field: "mrsi" },
  { title: "Contraction Time", field: "contraction_time_s",     unit: "s" },
  { title: "Ecc:Con Ratio",    field: "ecc_con_duration_ratio" },
  { title: "Eccentric Power",  field: "eccentric_mean_power_w", unit: "W" },
];
const PPU_PANELS: Panel[] = [
  { title: "mRSI",             field: "mrsi" },
  { title: "Contraction Time", field: "contraction_time_s",     unit: "s" },
];

export function MovementStrategyPanel({ data, kind }: Props) {
  const panels = kind === "cmj" ? CMJ_PANELS : PPU_PANELS;

  if (data.length === 0) return (
    <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.8rem", padding: "0.5rem 0" }}>
      No movement strategy data
    </div>
  );

  return (
    <div className={kind === "cmj" ? "plot-4" : "plot-2"}>
      {panels.map(({ title, field, unit }) => {
        const lineData = data.map((d) => ({
          date:  d.date,
          value: d[field] as number | null,
        }));
        return (
          <div key={title} className="plot-frame">
            <MetricLineChart title={title} data={lineData} unit={unit} />
          </div>
        );
      })}
    </div>
  );
}
