"use client";

/**
 * Shared pieces of the week-at-a-glance layout used by Program Lift and
 * Program Throwing: Sunday → Saturday columns, day headers, and a line chart
 * whose points sit under each day header.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Group, Text } from "@mantine/core";
import { fmtDate } from "./fetcher";
import { dayNum, dayStr } from "./programHeat";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEK_GAP = 8;

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Day number of the Sunday of the week containing d. */
export const weekStart = (d: string) => dayNum(d) - new Date(dayNum(d) * 86_400_000).getUTCDay();

/** The 7 dates (Sunday → Saturday) of the week starting at day number `sunday`. */
export const weekDates = (sunday: number) => Array.from({ length: 7 }, (_, i) => dayStr(sunday + i));

export const shortDate = (d: string) => fmtDate(d).replace(/, \d{4}$/, "");

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export interface WeekSeries {
  key: string;
  label: string;
  color: string;
  /** One value per day (Sunday → Saturday); null leaves a gap (no point, line broken). */
  values: Array<number | null>;
  dashed?: boolean;
}

/** Lines on one scale (0 → yMax), one point under each day header. */
export function WeekLineChart({ series, yMax, topLabel, bottomLabel, hover, setHover, tooltip, height = 120 }: {
  series: WeekSeries[];
  yMax: number;
  topLabel?: string;
  bottomLabel?: string;
  hover: number | null;
  setHover: (i: number | null) => void;
  tooltip: (i: number) => ReactNode;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const H = height;
  const top = 10;
  const bottom = 18;
  const colW = (width - WEEK_GAP * 6) / 7;
  const x = (i: number) => i * (colW + WEEK_GAP) + colW / 2;
  const y = (v: number) => top + (1 - Math.min(v, yMax) / (yMax || 1)) * (H - top - bottom);
  const path = (vals: Array<number | null>) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };
  return (
    <div ref={ref} style={{ position: "relative", height: H }}>
      {width > 0 && (
        <svg width={width} height={H} style={{ display: "block", overflow: "visible" }}>
          {[0, 0.5, 1].map((g) => (
            <g key={g}>
              <line x1={0} x2={width} y1={y(g * yMax)} y2={y(g * yMax)} stroke="rgba(255,255,255,0.07)" strokeDasharray={g ? "3 3" : undefined} />
              {g === 1 && topLabel && <text x={0} y={y(yMax) - 3} fill="var(--text-muted)" fontSize={9}>{topLabel}</text>}
              {g === 0 && bottomLabel && <text x={0} y={y(0) - 3} fill="var(--text-muted)" fontSize={9}>{bottomLabel}</text>}
            </g>
          ))}
          {hover != null && <rect x={x(hover) - colW / 2} y={0} width={colW} height={H} fill="rgba(255,255,255,0.04)" rx={6} />}
          {series.map((s) => (
            <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined} />
          ))}
          {series.map((s) => s.values.map((v, i) => v == null ? null : (
            <circle key={`${s.key}-${i}`} cx={x(i)} cy={y(v)} r={4.5} fill={s.color} stroke="var(--bg-secondary)" strokeWidth={2} />
          )))}
          {Array.from({ length: 7 }, (_, i) => (
            <rect key={i} x={x(i) - colW / 2} y={0} width={colW} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          ))}
        </svg>
      )}
      {hover != null && width > 0 && (
        <div style={{
          position: "absolute", top: -6, left: Math.min(Math.max(x(hover) - 115, 0), width - 230), width: 230, pointerEvents: "none",
          background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: "0.78rem", zIndex: 2,
        }}>
          {tooltip(hover)}
        </div>
      )}
    </div>
  );
}

/** Legend swatch for a WeekSeries (dashed series get a dashed swatch). */
export function SeriesKey({ color, dashed, children }: { color: string; dashed?: boolean; children: ReactNode }) {
  return (
    <Group gap={6}>
      <span style={{ width: 16, height: 0, borderTop: `3px ${dashed ? "dashed" : "solid"} ${color}` }} />
      <Text size="xs" c="dimmed">{children}</Text>
    </Group>
  );
}

/** ✓ all sets done · ◐ some · ○ logged, none done. Nothing when not logged. */
export function DoneMark({ done, sets }: { done: number | null; sets: number }) {
  if (done == null) return null;
  const full = sets > 0 && done >= sets;
  return (
    <span style={{ color: full ? "#3ecf8e" : done > 0 ? "#e7b53c" : "var(--text-muted)", marginRight: 4 }}>
      {full ? "✓" : done > 0 ? "◐" : "○"}
    </span>
  );
}

/** Day headers + full-width chart + day cells, all on the same 7 columns. */
export function WeekGrid({ dates, today, selected, onSelect, setHover, chart, cell }: {
  dates: string[];
  today: string;
  selected?: string | null;
  onSelect?: (date: string) => void;
  setHover: (i: number | null) => void;
  chart: ReactNode;
  cell: (date: string, i: number) => ReactNode;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", columnGap: WEEK_GAP, rowGap: 6 }}>
      {dates.map((d, i) => (
        <div key={d} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={onSelect ? () => onSelect(d) : undefined}
          style={{ textAlign: "center", cursor: onSelect ? "pointer" : undefined }}>
          <Text size="sm" fw={700} c={d === today ? "var(--accent)" : undefined}>{WEEKDAYS[i]}</Text>
          <Text size="xs" c={d === selected ? undefined : "dimmed"} fw={d === selected ? 700 : undefined}>{shortDate(d)}</Text>
        </div>
      ))}
      <div style={{ gridColumn: "1 / -1" }}>{chart}</div>
      {dates.map((d, i) => cell(d, i))}
    </div>
  );
}
