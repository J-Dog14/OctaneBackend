"use client";

/**
 * Front/back body map coloured by how recently each muscle was trained
 * (programHeat.ts). Original drawing; hover a muscle for its sets and exercises.
 */

import { useState } from "react";
import { MUSCLES, type MuscleId } from "@/lib/coach/programMuscles";
import { BACK_PATHS, BODY_SILHOUETTE, FRONT_PATHS } from "./bodyMapPaths";
import { heatColor, type MuscleHeat } from "./programHeat";
import { fmtDate } from "./fetcher";

const MIRROR = "translate(200,0) scale(-1,1)";
const SILHOUETTE = "#2b3646";
const OUTLINE = "var(--bg-secondary)";

function View({
  title, paths, heat, offsetX, hover, setHover,
}: {
  title: string;
  paths: Partial<Record<MuscleId, string[]>>;
  heat: Record<MuscleId, MuscleHeat>;
  offsetX: number;
  hover: MuscleId | null;
  setHover: (m: MuscleId | null) => void;
}) {
  return (
    <g transform={`translate(${offsetX},0)`}>
      <path d={BODY_SILHOUETTE} fill={SILHOUETTE} />
      <path d={BODY_SILHOUETTE} fill={SILHOUETTE} transform={MIRROR} />
      <ellipse cx={100} cy={30} rx={15} ry={19} fill="#3a4658" />
      {(Object.entries(paths) as Array<[MuscleId, string[]]>).map(([m, ds]) => {
        const fill = heatColor(heat[m]?.level ?? 0);
        const active = hover === m;
        return (
          <g key={m} onMouseEnter={() => setHover(m)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
            {ds.flatMap((d, i) => [
              <path key={`${i}a`} d={d} fill={fill} stroke={active ? "#fff" : OUTLINE} strokeWidth={active ? 1.6 : 1.2} />,
              <path key={`${i}b`} d={d} fill={fill} stroke={active ? "#fff" : OUTLINE} strokeWidth={active ? 1.6 : 1.2} transform={MIRROR} />,
            ])}
          </g>
        );
      })}
      <text x={100} y={438} textAnchor="middle" fill="var(--text-secondary)" fontSize={11}>{title}</text>
    </g>
  );
}

export function BodyMap({ heat, height = 460 }: { heat: Record<MuscleId, MuscleHeat>; height?: number }) {
  const [hover, setHover] = useState<MuscleId | null>(null);
  const h = hover ? heat[hover] : null;
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: (height * 420) / 445 }}>
      <svg viewBox="0 0 420 445" width="100%" style={{ display: "block" }} role="img" aria-label="Muscles worked recently, front and back">
        <View title="Front" paths={FRONT_PATHS} heat={heat} offsetX={0} hover={hover} setHover={setHover} />
        <View title="Back" paths={BACK_PATHS} heat={heat} offsetX={220} hover={hover} setHover={setHover} />
      </svg>
      {hover && h && (
        <div style={{
          position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", pointerEvents: "none",
          background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px",
          fontSize: "0.8rem", minWidth: 200, boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
        }}>
          <div style={{ fontWeight: 700 }}>{MUSCLES[hover]}</div>
          <div style={{ color: "var(--text-secondary)" }}>
            {h.lastDate ? `${h.load.toFixed(1)} effective sets · last trained ${fmtDate(h.lastDate)}` : "Not trained in the last 4 weeks"}
          </div>
          {h.exercises.slice(0, 4).map((x) => (
            <div key={x.name} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span>{x.name}</span><span style={{ color: "var(--text-secondary)" }}>{Number.isInteger(x.sets) ? x.sets : x.sets.toFixed(1)} sets</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
