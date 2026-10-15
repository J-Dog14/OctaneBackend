"use client";

/**
 * Pitch report: the TrackMan portal's "Pitching Player" layout, rebuilt on our
 * own pitch-by-pitch data (Trackman bullpens/games + Savant games).
 *
 *   Release   | table: #, velo, max, spin, max, ext | Velo vs spin | Release position
 *   Movement  | table: IVB, HB, tilt, eff, gyro     | Breaks       | Spin direction (clock)
 *   Location  | table: zone/edge/out, VAA, HAA      | Strike zone  | Approach angle
 *   Pitch log (every pitch)
 *
 * Click any pitch (dot or log row) to select it everywhere; ← / → step through
 * pitches, Esc clears. Click a pitch type (table row or chip) to show only it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  ActionIcon, Alert, Badge, Button, Chip, Group, Loader, ScrollArea, SegmentedControl, Select, Stack, Table, Text, TextInput, Tooltip,
} from "@mantine/core";
import {
  CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip as RTooltip, XAxis, YAxis,
} from "recharts";
import { PITCH_COLORS, PITCH_LABELS, type PitchCode } from "@/lib/pitch-intel/pitch-types";
import type { PitchLog, PitchResult, PitchRow, PitchSessionRef, SessionKind } from "@/lib/coach/pitchLog";
import { fmt, fmtDate, swrOpts } from "./fetcher";
import {
  EDGE, ZONE_BOT, ZONE_HALF_WIDTH, ZONE_TOP, summarize, tiltMinutes, timeOnly, typesIn, zoneOf, type TypeSummary,
} from "./pitchStats";
import { PitchDot } from "./pitching";

// ---------------------------------------------------------------------------
// Look & feel (matches the other coach charts)
// ---------------------------------------------------------------------------

const AXIS_TICK = { fill: "rgba(255,255,255,0.5)", fontSize: 11 };
const AXIS_LABEL = { fill: "rgba(255,255,255,0.5)", fontSize: 11 };
const GRID = "rgba(255,255,255,0.07)";
const TOOLTIP_STYLE = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: "0.78rem",
  color: "var(--text-primary)",
  padding: "6px 10px",
} as const;

export const RESULT_COLORS: Record<PitchResult, string> = {
  ball: "#8d939c",
  called: "#f59f00",
  whiff: "#fa5252",
  foul: "#4dabf7",
  inplay: "#40c057",
  hbp: "#be4bdb",
};
export const RESULT_LABELS: Record<PitchResult, string> = {
  ball: "Ball",
  called: "Called strike",
  whiff: "Whiff",
  foul: "Foul",
  inplay: "In play",
  hbp: "HBP",
};

type Show = "pitches" | "averages" | "both";

const base = (uuid: string) => `/api/coach/athletes/${encodeURIComponent(uuid)}/pitches`;

function sessionLabel(s: PitchSessionRef): string {
  const what = s.source === "savant" ? `Game · Savant${s.detail ? ` ${s.detail}` : ""}` : s.kind === "game" ? "Game · Trackman" : "Bullpen · Trackman";
  return `${fmtDate(s.date)} · ${what} · ${s.pitches} P`;
}

const isoDaysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// Scatter chart with clickable pitches + type averages
// ---------------------------------------------------------------------------

/** `x` is the plotted position; `rawX` the value itself (they differ only when the x axis is mirrored). */
type Pt = { x: number; rawX: number; y: number; id: string; type: PitchCode; avg?: boolean; n?: number };

interface ScatterProps {
  pitches: PitchRow[];
  summaries: Map<PitchCode, TypeSummary>;
  x: (p: PitchRow) => number | null;
  y: (p: PitchRow) => number | null;
  avgX: (s: TypeSummary) => number | null;
  avgY: (s: TypeSummary) => number | null;
  xLabel: string;
  yLabel: string;
  xDomain?: [number, number] | [string, string];
  xTicks?: number[];
  yTicks?: number[];
  yDomain?: [number, number] | [string, string];
  zeroLines?: boolean;
  show: Show;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSolo: (t: PitchCode) => void;
  fmtX?: (v: number) => string;
  fmtY?: (v: number) => string;
  height?: number;
  /** Draw the x axis mirrored (LHP breaks). Tick labels and tooltips keep the raw values. */
  mirrorX?: boolean;
}

function PitchScatter(props: ScatterProps) {
  const { pitches, summaries, x, y, avgX, avgY, show, selectedId, onSelect, onSolo, height = 300 } = props;
  const sx = props.mirrorX ? -1 : 1;
  const types = typesIn(pitches);
  const byType = useMemo(() => {
    const m = new Map<PitchCode, Pt[]>();
    for (const p of pitches) {
      const xv = x(p);
      const yv = y(p);
      if (xv == null || yv == null) continue;
      const arr = m.get(p.type) ?? [];
      arr.push({ x: xv * sx, rawX: xv, y: yv, id: p.id, type: p.type });
      m.set(p.type, arr);
    }
    return m;
  }, [pitches, x, y, sx]);
  const avgs = useMemo(() => {
    const out: Pt[] = [];
    for (const [t, s] of summaries) {
      const xv = avgX(s);
      const yv = avgY(s);
      if (xv != null && yv != null) out.push({ x: xv * sx, rawX: xv, y: yv, id: `avg:${t}`, type: t, avg: true, n: s.n });
    }
    return out;
  }, [summaries, avgX, avgY, sx]);
  const fmtTickX = (v: number) => (props.fmtX ? props.fmtX(v * sx + 0) : String(v * sx + 0));
  const plotted = [...byType.values()].reduce((a, b) => a + b.length, 0);
  if (!plotted) return <Text size="sm" c="dimmed" py="xl" ta="center">No data for this chart.</Text>;

  const dot = (props2: { cx?: number; cy?: number; payload?: Pt }) => {
    const { cx, cy, payload } = props2;
    if (cx == null || cy == null || !payload) return <g />;
    const sel = payload.id === selectedId;
    const dim = selectedId != null && !sel;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={sel ? 7 : 4.5}
        fill={PITCH_COLORS[payload.type]}
        fillOpacity={dim ? 0.35 : 0.9}
        stroke={sel ? "#fff" : "rgba(0,0,0,0.35)"}
        strokeWidth={sel ? 2.5 : 0.75}
        style={{ cursor: "pointer" }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(payload.id);
        }}
      />
    );
  };
  const diamond = (props2: { cx?: number; cy?: number; payload?: Pt }) => {
    const { cx, cy, payload } = props2;
    if (cx == null || cy == null || !payload) return <g />;
    const r = 9;
    return (
      <path
        d={`M${cx},${cy - r} L${cx + r},${cy} L${cx},${cy + r} L${cx - r},${cy} Z`}
        fill={PITCH_COLORS[payload.type]}
        stroke="#fff"
        strokeWidth={2}
        style={{ cursor: "pointer" }}
        onClick={(e) => {
          e.stopPropagation();
          onSolo(payload.type);
        }}
      />
    );
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: 2 }} accessibilityLayer={false}>
        <CartesianGrid stroke={GRID} />
        <XAxis
          type="number" dataKey="x" domain={props.xDomain ?? ["auto", "auto"]} tick={AXIS_TICK} tickLine={false}
          axisLine={{ stroke: "rgba(255,255,255,0.12)" }} tickFormatter={props.mirrorX ? fmtTickX : props.fmtX} ticks={props.xTicks}
          label={{ value: props.xLabel, position: "insideBottom", offset: -10, ...AXIS_LABEL }}
        />
        <YAxis
          type="number" dataKey="y" domain={props.yDomain ?? ["auto", "auto"]} tick={AXIS_TICK} tickLine={false}
          axisLine={false} width={56} tickFormatter={props.fmtY} ticks={props.yTicks}
          label={{ value: props.yLabel, angle: -90, position: "insideLeft", offset: 0, ...AXIS_LABEL }}
        />
        {props.zeroLines && <ReferenceLine x={0} stroke="rgba(255,255,255,0.2)" />}
        {props.zeroLines && <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />}
        <RTooltip
          cursor={false}
          content={({ payload }) => {
            const p = payload?.[0]?.payload as Pt | undefined;
            if (!p) return null;
            return (
              <div style={TOOLTIP_STYLE}>
                <div style={{ fontWeight: 600 }}>
                  <PitchDot code={p.type} />
                  {PITCH_LABELS[p.type]}
                  {p.avg ? ` average (${p.n})` : ""}
                </div>
                <div>
                  {props.xLabel.split(" (")[0]}: {props.fmtX ? props.fmtX(p.rawX) : fmt(p.rawX)} · {props.yLabel.split(" (")[0]}: {props.fmtY ? props.fmtY(p.y) : fmt(p.y)}
                </div>
                <div style={{ opacity: 0.6, fontSize: "0.7rem" }}>{p.avg ? "click to show only this pitch" : "click to select"}</div>
              </div>
            );
          }}
        />
        {show !== "averages" &&
          types.map((t) => (
            <Scatter key={t} data={byType.get(t) ?? []} shape={dot} isAnimationActive={false} />
          ))}
        {show !== "pitches" && <Scatter data={avgs} shape={diamond} isAnimationActive={false} />}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Strike zone (SVG, feet)
// ---------------------------------------------------------------------------

function StrikeZone({
  pitches, summaries, show, view, colorBy, selectedId, onSelect, onSolo,
}: {
  pitches: PitchRow[];
  summaries: Map<PitchCode, TypeSummary>;
  show: Show;
  view: "pitcher" | "catcher";
  colorBy: "type" | "result";
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSolo: (t: PitchCode) => void;
}) {
  const located = pitches.filter((p) => p.plateSide != null && p.plateHeight != null);
  // Savant pitches carry the batter's zone; average it, else the bullpen default.
  const tops = located.map((p) => p.zoneTop).filter((v): v is number => v != null);
  const bots = located.map((p) => p.zoneBot).filter((v): v is number => v != null);
  const top = tops.length ? tops.reduce((a, b) => a + b, 0) / tops.length : ZONE_TOP;
  const bot = bots.length ? bots.reduce((a, b) => a + b, 0) / bots.length : ZONE_BOT;
  // Show at least the zone plus a margin; grow to fit wild pitches (within reason).
  const W = Math.min(4, Math.max(2.2, ...located.map((p) => Math.abs(p.plateSide!) + 0.35)));
  const H0 = Math.max(-1, Math.min(0, ...located.map((p) => p.plateHeight! - 0.35)));
  const H1 = Math.min(7, Math.max(4.8, ...located.map((p) => p.plateHeight! + 0.35)));
  const vw = 320;
  const vh = (vw * (H1 - H0)) / (2 * W);
  const sx = (ft: number) => ((ft + W) / (2 * W)) * vw;
  const sy = (ft: number) => vh - ((ft - H0) / (H1 - H0)) * vh;
  const side = (s: number) => (view === "pitcher" ? s : -s);
  const hw = ZONE_HALF_WIDTH;
  const third = (2 * hw) / 3;
  const vthird = (top - bot) / 3;
  if (!located.length) return <Text size="sm" c="dimmed" py="xl" ta="center">No plate locations for these pitches.</Text>;

  const avgPts: Array<{ t: PitchCode; x: number; y: number }> = [];
  if (show !== "pitches") {
    for (const [t] of summaries) {
      const ps = located.filter((p) => p.type === t);
      if (!ps.length) continue;
      avgPts.push({
        t,
        x: ps.reduce((a, p) => a + side(p.plateSide!), 0) / ps.length,
        y: ps.reduce((a, p) => a + p.plateHeight!, 0) / ps.length,
      });
    }
  }
  const plateY = sy(0.25);
  return (
    <svg viewBox={`0 0 ${vw} ${vh}`} style={{ width: "100%", maxHeight: 360 }}>
      {/* edge band and zone */}
      <rect x={sx(-hw - EDGE)} y={sy(top + EDGE)} width={sx(hw + EDGE) - sx(-hw - EDGE)} height={sy(bot - EDGE) - sy(top + EDGE)}
        fill="none" stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
      <rect x={sx(-hw)} y={sy(top)} width={sx(hw) - sx(-hw)} height={sy(bot) - sy(top)} fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.6)" strokeWidth={1.5} />
      {[1, 2].map((i) => (
        <g key={i}>
          <line x1={sx(-hw + i * third)} x2={sx(-hw + i * third)} y1={sy(top)} y2={sy(bot)} stroke="rgba(255,255,255,0.25)" />
          <line x1={sx(-hw)} x2={sx(hw)} y1={sy(bot + i * vthird)} y2={sy(bot + i * vthird)} stroke="rgba(255,255,255,0.25)" />
        </g>
      ))}
      {/* home plate */}
      <path
        d={`M${sx(-0.708)},${plateY} L${sx(0.708)},${plateY} L${sx(0.708)},${plateY + 6} L${sx(0)},${plateY + 14} L${sx(-0.708)},${plateY + 6} Z`}
        fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.35)"
      />
      {show !== "averages" &&
        located.map((p) => {
          const sel = p.id === selectedId;
          const dim = selectedId != null && !sel;
          const color = colorBy === "result" ? (p.result ? RESULT_COLORS[p.result] : "#555") : PITCH_COLORS[p.type];
          return (
            <circle
              key={p.id}
              cx={sx(side(p.plateSide!))}
              cy={sy(p.plateHeight!)}
              r={sel ? 7 : 5}
              fill={color}
              fillOpacity={dim ? 0.3 : 0.85}
              stroke={sel ? "#fff" : "rgba(0,0,0,0.4)"}
              strokeWidth={sel ? 2.5 : 0.75}
              style={{ cursor: "pointer" }}
              onClick={() => onSelect(p.id)}
            >
              <title>{`${PITCH_LABELS[p.type]} #${p.no} · ${fmt(p.velo)} mph${p.result ? ` · ${RESULT_LABELS[p.result]}` : ""}`}</title>
            </circle>
          );
        })}
      {avgPts.map((a) => {
        const cx = sx(a.x);
        const cy = sy(a.y);
        return (
          <path key={a.t} d={`M${cx},${cy - 9} L${cx + 9},${cy} L${cx},${cy + 9} L${cx - 9},${cy} Z`} fill={PITCH_COLORS[a.t]} stroke="#fff" strokeWidth={2}
            style={{ cursor: "pointer" }} onClick={() => onSolo(a.t)}>
            <title>{`${PITCH_LABELS[a.t]} average location`}</title>
          </path>
        );
      })}
      <text x={6} y={14} fill="rgba(255,255,255,0.45)" fontSize={10}>{view === "pitcher" ? "Pitcher's view" : "Catcher's view"}</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Spin direction clock (SVG)
// ---------------------------------------------------------------------------

function SpinClock({
  pitches, summaries, show, selectedId, onSelect, onSolo,
}: {
  pitches: PitchRow[];
  summaries: Map<PitchCode, TypeSummary>;
  show: Show;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSolo: (t: PitchCode) => void;
}) {
  const withTilt = pitches.filter((p) => tiltMinutes(p.tilt) != null);
  if (!withTilt.length) return <Text size="sm" c="dimmed" py="xl" ta="center">No spin direction for these pitches.</Text>;
  const S = 300;
  const C = S / 2;
  const R = S / 2 - 26;
  // 12:00 at the top, clockwise; radius = spin efficiency when known (100% at the rim).
  const at = (minutes: number, frac: number) => {
    const a = (minutes / 720) * 2 * Math.PI;
    return { x: C + Math.sin(a) * R * frac, y: C - Math.cos(a) * R * frac };
  };
  const frac = (eff: number | null) => (eff == null ? 0.85 : Math.max(0.15, Math.min(1, eff / 100)));
  return (
    <svg viewBox={`0 0 ${S} ${S}`} style={{ width: "100%", maxHeight: 340 }}>
      <circle cx={C} cy={C} r={R} fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.35)" />
      <circle cx={C} cy={C} r={R * 0.5} fill="none" stroke="rgba(255,255,255,0.08)" strokeDasharray="3 4" />
      {Array.from({ length: 12 }, (_, i) => {
        const o = at(i * 60, 1);
        const lab = at(i * 60, 1.13);
        return (
          <g key={i}>
            <line x1={C + (o.x - C) * 0.94} y1={C + (o.y - C) * 0.94} x2={o.x} y2={o.y} stroke="rgba(255,255,255,0.4)" />
            <text x={lab.x} y={lab.y + 4} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize={11}>{i === 0 ? 12 : i}</text>
          </g>
        );
      })}
      {show !== "pitches" &&
        [...summaries.values()].map((s) => {
          const m = tiltMinutes(s.tilt);
          if (m == null || s.type === "ALL") return null;
          const p = at(m, frac(s.spinEff));
          const t = s.type as PitchCode;
          return (
            <g key={t} style={{ cursor: "pointer" }} onClick={() => onSolo(t)}>
              <line x1={C} y1={C} x2={p.x} y2={p.y} stroke={PITCH_COLORS[t]} strokeWidth={4} strokeLinecap="round" />
              <title>{`${PITCH_LABELS[t]} average tilt ${s.tilt}${s.spinEff != null ? ` · ${fmt(s.spinEff, 0)}% efficient` : ""}`}</title>
            </g>
          );
        })}
      {show !== "averages" &&
        withTilt.map((p) => {
          const pos = at(tiltMinutes(p.tilt)!, frac(p.spinEff));
          const sel = p.id === selectedId;
          const dim = selectedId != null && !sel;
          return (
            <circle key={p.id} cx={pos.x} cy={pos.y} r={sel ? 7 : 4.5} fill={PITCH_COLORS[p.type]} fillOpacity={dim ? 0.3 : 0.9}
              stroke={sel ? "#fff" : "rgba(0,0,0,0.35)"} strokeWidth={sel ? 2.5 : 0.75} style={{ cursor: "pointer" }} onClick={() => onSelect(p.id)}>
              <title>{`${PITCH_LABELS[p.type]} #${p.no} · tilt ${p.tilt}${p.spinEff != null ? ` · ${fmt(p.spinEff, 0)}% eff` : ""}`}</title>
            </circle>
          );
        })}
      <circle cx={C} cy={C} r={2.5} fill="rgba(255,255,255,0.6)" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Per-type tables
// ---------------------------------------------------------------------------

type Col = { label: string; get: (s: TypeSummary) => React.ReactNode; tip?: string };

function TypeTable({
  rows, total, cols, solo, onSolo,
}: {
  rows: TypeSummary[];
  total: TypeSummary;
  cols: Col[];
  solo: PitchCode | null;
  onSolo: (t: PitchCode) => void;
}) {
  return (
    <ScrollArea>
      <Table fz="sm" verticalSpacing={5} highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Pitch</Table.Th>
            <Table.Th ta="right">#</Table.Th>
            {cols.map((c, i) => (
              <Table.Th key={`${i}:${c.label}`} ta="right">
                {c.tip ? (
                  <Tooltip label={c.tip} withArrow multiline w={240}>
                    <span style={{ borderBottom: "1px dotted rgba(255,255,255,0.3)" }}>{c.label}</span>
                  </Tooltip>
                ) : (
                  c.label
                )}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => {
            const t = r.type as PitchCode;
            return (
              <Table.Tr key={t} onClick={() => onSolo(t)} style={{ cursor: "pointer", background: solo === t ? "rgba(255,255,255,0.06)" : undefined }}>
                <Table.Td style={{ whiteSpace: "nowrap" }}>
                  <PitchDot code={t} />
                  {PITCH_LABELS[t]}
                </Table.Td>
                <Table.Td ta="right">{r.n}</Table.Td>
                {cols.map((c, i) => (
                  <Table.Td key={`${i}:${c.label}`} ta="right">{c.get(r)}</Table.Td>
                ))}
              </Table.Tr>
            );
          })}
          {rows.length > 1 && (
            <Table.Tr style={{ borderTop: "1px solid var(--border)" }}>
              <Table.Td fw={600}>All</Table.Td>
              <Table.Td ta="right" fw={600}>{total.n}</Table.Td>
              {cols.map((c, i) => (
                <Table.Td key={`${i}:${c.label}`} ta="right" c="dimmed">{c.get(total)}</Table.Td>
              ))}
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

const pctCell = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);

// ---------------------------------------------------------------------------
// Selected pitch strip
// ---------------------------------------------------------------------------

function SelectedPitch({
  p, typeAvg, index, count, onPrev, onNext, onClose, showDate,
}: {
  p: PitchRow;
  typeAvg: TypeSummary | undefined;
  index: number;
  count: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  showDate: boolean;
}) {
  const delta = (v: number | null, a: number | null | undefined, digits = 1) => {
    if (v == null || a == null) return null;
    const d = v - a;
    if (Math.abs(d) < 10 ** -digits / 2) return <span style={{ opacity: 0.5 }}> (avg)</span>;
    return <span style={{ color: "var(--text-secondary)", fontSize: "0.72rem" }}> {d > 0 ? "+" : ""}{d.toFixed(digits)}</span>;
  };
  const item = (label: string, value: React.ReactNode, extra?: React.ReactNode) => (
    <div style={{ minWidth: 86 }}>
      <div style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-secondary)" }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}{extra}</div>
    </div>
  );
  return (
    <div className="card" style={{ marginBottom: 0, borderLeft: `4px solid ${PITCH_COLORS[p.type]}` }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group gap="lg" wrap="wrap" align="flex-start">
          <div style={{ minWidth: 150 }}>
            <Text fw={700}>
              <PitchDot code={p.type} />
              {PITCH_LABELS[p.type]} · #{p.no}
            </Text>
            <Text size="xs" c="dimmed">
              {showDate ? `${fmtDate(p.date)} · ` : ""}
              {p.context ?? timeOnly(p.time) ?? ""} {p.source === "savant" ? "· Savant" : "· Trackman"}
            </Text>
            {p.tagged && p.tagged !== PITCH_LABELS[p.type] && <Text size="xs" c="dimmed">tagged “{p.tagged}”</Text>}
          </div>
          {item("Velo", `${fmt(p.velo)} mph`, delta(p.velo, typeAvg?.velo))}
          {item("Spin", p.spin ?? "—", delta(p.spin, typeAvg?.spin, 0))}
          {item("IVB", `${fmt(p.ivb)}″`, delta(p.ivb, typeAvg?.ivb))}
          {item("HB (arm)", `${fmt(p.hbArm)}″`, delta(p.hbArm, typeAvg?.hbArm))}
          {item("Tilt", p.tilt ?? "—", p.measuredTilt ? <span style={{ opacity: 0.6, fontSize: "0.72rem" }}> (meas {p.measuredTilt})</span> : null)}
          {item("Spin eff / gyro", `${p.spinEff == null ? "—" : `${fmt(p.spinEff, 0)}%`} / ${p.gyro == null ? "—" : `${fmt(p.gyro)}°`}`)}
          {item("Ext", `${fmt(p.extension, 2)} ft`, delta(p.extension, typeAvg?.extension, 2))}
          {item("Release ht / side", `${fmt(p.relHeight, 2)} / ${fmt(p.relSide, 2)}`)}
          {item("VAA / HAA", `${fmt(p.vaa)}° / ${fmt(p.haa)}°`)}
          {item("Plate ht / side", `${fmt(p.plateHeight, 2)} / ${fmt(p.plateSide, 2)}`)}
          {p.result && item("Result", <span style={{ color: RESULT_COLORS[p.result] }}>{RESULT_LABELS[p.result]}</span>,
            p.balls != null && p.strikes != null ? <span style={{ opacity: 0.6, fontSize: "0.72rem" }}> ({p.balls}-{p.strikes})</span> : null)}
          {p.exitVelo != null && item("Exit velo", `${fmt(p.exitVelo)} mph`)}
        </Group>
        <Group gap={4} wrap="nowrap">
          <Text size="xs" c="dimmed" mr={4}>{index + 1} / {count}</Text>
          <ActionIcon variant="subtle" onClick={onPrev} aria-label="Previous pitch">‹</ActionIcon>
          <ActionIcon variant="subtle" onClick={onNext} aria-label="Next pitch">›</ActionIcon>
          <ActionIcon variant="subtle" onClick={onClose} aria-label="Clear selection">✕</ActionIcon>
        </Group>
      </Group>
      <Text size="xs" c="dimmed" mt={6}>Small numbers are the difference from this pitch type&apos;s average. ← / → step through pitches, Esc clears.</Text>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

function Panel({ title, sub, children, right }: { title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 0, minWidth: 0 }}>
      <Group justify="space-between" mb={6} wrap="nowrap">
        <div>
          <Text fw={700} size="sm" style={{ letterSpacing: "0.05em", textTransform: "uppercase" }}>{title}</Text>
          {sub && <Text size="xs" c="dimmed">{sub}</Text>}
        </div>
        {right}
      </Group>
      {children}
    </div>
  );
}

const BREAK_TICKS = [-25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25];

const ROW_STYLE: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(470px, 1.35fr) minmax(280px, 1fr) minmax(280px, 1fr)", gap: 12, alignItems: "stretch" };

export function PitchReport({ athleteUuid }: { athleteUuid: string }) {
  const { data: sessData, error: sessErr, isLoading: sessLoading } = useSWR<{ sessions: PitchSessionRef[] }>(`${base(athleteUuid)}/sessions`, swrOpts);
  const sessions = useMemo(() => sessData?.sessions ?? [], [sessData]);

  const [scope, setScope] = useState<string | null>(null); // session key or "range:*"
  const [kinds, setKinds] = useState<"all" | SessionKind>("all");
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: isoDaysAgo(30), to: isoDaysAgo(0) });
  const [hidden, setHidden] = useState<Set<PitchCode>>(new Set());
  const [show, setShow] = useState<Show>("both");
  const [zoneView, setZoneView] = useState<"pitcher" | "catcher">("pitcher");
  const [colorBy, setColorBy] = useState<"type" | "result">("type");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const active = scope ?? sessions[0]?.key ?? null;
  const isRange = active?.startsWith("range:") ?? false;
  const url = useMemo(() => {
    if (!active) return null;
    if (!isRange) return `${base(athleteUuid)}?session=${encodeURIComponent(active)}`;
    const preset = active.slice(6);
    const year = new Date().getFullYear();
    const [from, to] =
      preset === "30d" ? [isoDaysAgo(30), isoDaysAgo(0)]
        : preset === "90d" ? [isoDaysAgo(90), isoDaysAgo(0)]
          : preset === "season" ? [`${year}-01-01`, `${year}-12-31`]
            : preset === "custom" ? [custom.from, custom.to]
              : ["1900-01-01", "2999-12-31"];
    const k = kinds === "all" ? "game,bullpen" : kinds;
    return `${base(athleteUuid)}?from=${from}&to=${to}&kinds=${k}`;
  }, [active, isRange, athleteUuid, kinds, custom]);

  const { data, error, isLoading } = useSWR<PitchLog>(url, swrOpts);
  const all = useMemo(() => data?.pitches ?? [], [data]);
  const allTypes = useMemo(() => typesIn(all), [all]);
  const pitches = useMemo(() => all.filter((p) => !hidden.has(p.type)), [all, hidden]);
  const types = useMemo(() => typesIn(pitches), [pitches]);
  const summaries = useMemo(() => {
    const m = new Map<PitchCode, TypeSummary>();
    for (const t of types) m.set(t, summarize(pitches, t, pitches.length));
    return m;
  }, [pitches, types]);
  const total = useMemo(() => summarize(pitches, "ALL", pitches.length), [pitches]);
  const rows = [...summaries.values()];
  const hasResults = pitches.some((p) => p.result != null);
  const multiDay = new Set(all.map((p) => p.date)).size > 1;

  // New session or range: drop the selection and type filters (React's
  // "adjust state when a prop changes" pattern, no effect needed).
  const [shownUrl, setShownUrl] = useState(url);
  if (shownUrl !== url) {
    setShownUrl(url);
    setSelectedId(null);
    setHidden(new Set());
  }
  const zoneColor = hasResults ? colorBy : "type";

  const selIndex = selectedId ? pitches.findIndex((p) => p.id === selectedId) : -1;
  const selected = selIndex >= 0 ? pitches[selIndex] : null;
  const step = useCallback(
    (d: number) => {
      if (!pitches.length) return;
      const i = selIndex < 0 ? 0 : (selIndex + d + pitches.length) % pitches.length;
      setSelectedId(pitches[i]!.id);
    },
    [pitches, selIndex],
  );
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "Escape") setSelectedId(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, step]);
  useEffect(() => {
    if (!selectedId) return;
    logRef.current?.querySelector(`[data-pid="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const solo = types.length === 1 && allTypes.length > 1 ? types[0]! : null;
  const onSolo = useCallback(
    (t: PitchCode) => {
      // Click a type: show only it; click it again: show everything.
      setHidden((h) => (allTypes.length > 1 && allTypes.every((x) => x === t || h.has(x)) && !h.has(t) ? new Set() : new Set(allTypes.filter((x) => x !== t))));
    },
    [allTypes],
  );
  const select = useCallback((id: string) => setSelectedId((cur) => (cur === id ? null : id)), []);

  if (sessLoading) return <Loader size="sm" />;
  if (sessErr) return <Alert color="red">{sessErr.message}</Alert>;
  if (!sessions.length) return <Text c="dimmed">No pitch-by-pitch data for this athlete yet (Trackman or Savant).</Text>;

  const options = [
    {
      group: "Date range",
      items: [
        { value: "range:30d", label: "Last 30 days" },
        { value: "range:90d", label: "Last 90 days" },
        { value: "range:season", label: `${new Date().getFullYear()} season` },
        { value: "range:all", label: "All pitches" },
        { value: "range:custom", label: "Custom dates…" },
      ],
    },
    { group: "Sessions & games", items: sessions.map((s) => ({ value: s.key, label: sessionLabel(s) })) },
  ];
  const sessionInfo = !isRange ? sessions.find((s) => s.key === active) : null;
  const scatterCommon = { pitches, summaries, show, selectedId, onSelect: select, onSolo };
  // Tagged LHP (most pitches in view): the break chart is mirrored so arm side reads on the left.
  const lefty = pitches.length > 0 && pitches.filter((p) => p.throws === "L").length > pitches.length / 2;

  return (
    <Stack gap="md" className="pitch-report">
      {/* recharts focuses the clicked series group; hide the browser's focus box around it */}
      <style>{`.pitch-report .recharts-wrapper :focus { outline: none; }`}</style>
      {/* Controls */}
      <Group gap="sm" align="flex-end" wrap="wrap">
        <Select label="Showing" data={options} value={active} onChange={(v) => v && setScope(v)} w={400} allowDeselect={false} searchable maxDropdownHeight={420} />
        {isRange && (
          <SegmentedControl value={kinds} onChange={(v) => setKinds(v as "all" | SessionKind)}
            data={[{ value: "all", label: "All" }, { value: "bullpen", label: "Bullpens" }, { value: "game", label: "Games" }]} />
        )}
        {active === "range:custom" && (
          <>
            <TextInput type="date" label="From" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.currentTarget.value }))} w={160} />
            <TextInput type="date" label="To" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.currentTarget.value }))} w={160} />
          </>
        )}
        <SegmentedControl value={show} onChange={(v) => setShow(v as Show)}
          data={[{ value: "both", label: "Pitches + averages" }, { value: "pitches", label: "Pitches" }, { value: "averages", label: "Averages" }]} />
      </Group>

      {allTypes.length > 0 && (
        <Group gap="xs">
          <Text size="sm" c="dimmed">Pitch types:</Text>
          {allTypes.map((t) => (
            <Chip key={t} size="xs" checked={!hidden.has(t)} color="gray" variant="outline"
              onChange={() => setHidden((h) => {
                const n = new Set(h);
                if (n.has(t)) n.delete(t); else n.add(t);
                return n.size >= allTypes.length ? h : n;
              })}>
              <PitchDot code={t} />
              {PITCH_LABELS[t]}
            </Chip>
          ))}
          {hidden.size > 0 && <Button size="compact-xs" variant="subtle" onClick={() => setHidden(new Set())}>Show all</Button>}
          <Text size="xs" c="dimmed" ml="auto">
            {isLoading ? "Loading…" : `${pitches.length} pitches${multiDay ? ` · ${new Set(pitches.map((p) => p.sessionKey)).size} sessions` : ""}`}
            {sessionInfo ? ` · ${sessionInfo.source === "savant" ? "Savant" : `Trackman ${sessionInfo.detail === "portal" ? "portal" : "upload"}`}` : ""}
          </Text>
        </Group>
      )}

      {error && <Alert color="red">{error.message}</Alert>}
      {data?.truncated && <Alert color="yellow" variant="light">Showing the newest {all.length.toLocaleString()} pitches in this range. Narrow the dates to see older ones.</Alert>}
      {isLoading && !data && <Loader size="sm" />}

      {data && !all.length && <Text c="dimmed">No pitches in this range.</Text>}

      {pitches.length > 0 && (
        <>
          {selected && (
            <SelectedPitch p={selected} typeAvg={summaries.get(selected.type)} index={selIndex} count={pitches.length}
              onPrev={() => step(-1)} onNext={() => step(1)} onClose={() => setSelectedId(null)} showDate={multiDay} />
          )}

          {/* Release */}
          <div style={ROW_STYLE}>
            <Panel title="Release" sub="averages · click a pitch type to show only it">
              <TypeTable rows={rows} total={total} solo={solo} onSolo={onSolo} cols={[
                { label: "Usage", get: (s) => (s.usage == null ? "" : pctCell(s.usage)) },
                { label: "Velo", get: (s) => <b>{fmt(s.velo)}</b> },
                { label: "Max", get: (s) => fmt(s.veloMax) },
                { label: "Spin", get: (s) => fmt(s.spin, 0) },
                { label: "Max", get: (s) => fmt(s.spinMax, 0) },
                { label: "Ext", get: (s) => fmt(s.extension) },
                { label: "Rel ht", get: (s) => fmt(s.relHeight, 2) },
                { label: "Rel side", get: (s) => fmt(s.relSide, 2), tip: "Feet from center, pitcher's view (+ = the pitcher's right)." },
              ]} />
            </Panel>
            <Panel title="Velo vs spin">
              <PitchScatter {...scatterCommon} x={(p) => p.velo} y={(p) => p.spin} avgX={(s) => s.velo} avgY={(s) => s.spin}
                xLabel="Velo (mph)" yLabel="Spin (rpm)" fmtX={(v) => v.toFixed(0)} fmtY={(v) => v.toFixed(0)} />
            </Panel>
            <Panel title="Release position" sub="pitcher's view">
              <PitchScatter {...scatterCommon} x={(p) => p.relSide} y={(p) => p.relHeight} avgX={(s) => s.relSide} avgY={(s) => s.relHeight}
                xLabel="Release side (ft)" yLabel="Release height (ft)" fmtX={(v) => v.toFixed(2)} fmtY={(v) => v.toFixed(2)} />
            </Panel>
          </div>

          {/* Movement */}
          <div style={ROW_STYLE}>
            <Panel title="Movement" sub="HB arm side positive · inches">
              <TypeTable rows={rows} total={total} solo={solo} onSolo={onSolo} cols={[
                { label: "IVB", get: (s) => <b>{fmt(s.ivb)}</b> },
                { label: "HB", get: (s) => <b>{fmt(s.hbArm)}</b> },
                { label: "Tilt", get: (s) => s.tilt ?? "—" },
                ...(pitches.some((p) => p.measuredTilt) ? [{ label: "M. tilt", get: (s: TypeSummary) => s.measuredTilt ?? "—", tip: "Measured (3D) spin direction, when the radar has it." }] : []),
                ...(pitches.some((p) => p.spinEff != null) ? [{ label: "Spin eff", get: (s: TypeSummary) => pctCell(s.spinEff) }] : []),
                ...(pitches.some((p) => p.gyro != null) ? [{ label: "Gyro", get: (s: TypeSummary) => (s.gyro == null ? "—" : `${fmt(s.gyro)}°`) }] : []),
              ]} />
            </Panel>
            <Panel title="Breaks" sub={lefty ? "arm side ← → glove side · LHP, drawn as it breaks" : "glove side ← → arm side"}>
              <PitchScatter {...scatterCommon} mirrorX={lefty} x={(p) => p.hbArm} y={(p) => p.ivb} avgX={(s) => s.hbArm} avgY={(s) => s.ivb}
                xLabel="Horizontal break (in)" yLabel="IVB (in)" xDomain={[-25, 25]} yDomain={[-25, 25]} xTicks={BREAK_TICKS} yTicks={BREAK_TICKS} zeroLines fmtX={(v) => v.toFixed(0)} fmtY={(v) => v.toFixed(0)} />
            </Panel>
            <Panel title="Spin direction" sub="clock tilt, pitcher's view · distance from center = spin efficiency">
              <SpinClock {...scatterCommon} />
            </Panel>
          </div>

          {/* Location */}
          <div style={ROW_STYLE}>
            <Panel title="Location" sub={hasResults ? "zone from plate location · results from the game feed" : "zone from plate location"}>
              <TypeTable rows={rows} total={total} solo={solo} onSolo={onSolo} cols={[
                { label: "Zone", get: (s) => pctCell(s.zonePct), tip: "Share of located pitches inside the strike zone (bullpens: 1.5–3.5 ft; games: the batter's zone)." },
                { label: "Edge", get: (s) => pctCell(s.edgePct), tip: "Just outside the zone (within ~3 in)." },
                { label: "Out", get: (s) => pctCell(s.outPct) },
                ...(hasResults
                  ? [
                      { label: "Strike%", get: (s: TypeSummary) => pctCell(s.strikePct), tip: "Called + swinging strikes, fouls and balls in play, per pitch." },
                      { label: "CSW%", get: (s: TypeSummary) => pctCell(s.cswPct), tip: "Called + swinging strikes per pitch." },
                      { label: "Whiff%", get: (s: TypeSummary) => (s.whiffPct == null ? "—" : `${s.whiffPct.toFixed(0)}%${s.swings < 10 ? "*" : ""}`), tip: "Whiffs per swing. * = fewer than 10 swings." },
                    ]
                  : []),
                { label: "VAA", get: (s) => fmt(s.vaa) },
                { label: "HAA", get: (s) => fmt(s.haa) },
              ]} />
            </Panel>
            <Panel
              title="Strike zone"
              right={
                <Group gap={6} wrap="nowrap">
                  {hasResults && (
                    <SegmentedControl size="xs" value={zoneColor} onChange={(v) => setColorBy(v as "type" | "result")}
                      data={[{ value: "type", label: "Type" }, { value: "result", label: "Result" }]} />
                  )}
                  <SegmentedControl size="xs" value={zoneView} onChange={(v) => setZoneView(v as "pitcher" | "catcher")}
                    data={[{ value: "pitcher", label: "Pitcher" }, { value: "catcher", label: "Catcher" }]} />
                </Group>
              }
            >
              <StrikeZone {...scatterCommon} view={zoneView} colorBy={zoneColor} />
              {zoneColor === "result" && (
                <Group gap={10} mt={4}>
                  {(Object.keys(RESULT_COLORS) as PitchResult[]).map((r) => (
                    <Text key={r} size="xs" c="dimmed">
                      <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: RESULT_COLORS[r], marginRight: 4 }} />
                      {RESULT_LABELS[r]}
                    </Text>
                  ))}
                </Group>
              )}
            </Panel>
            <Panel title="Approach angle" sub="at the front of the plate">
              <PitchScatter {...scatterCommon} x={(p) => p.haa} y={(p) => p.vaa} avgX={(s) => s.haa} avgY={(s) => s.vaa}
                xLabel="HAA (°)" yLabel="VAA (°)" fmtX={(v) => v.toFixed(0)} fmtY={(v) => v.toFixed(0)} />
            </Panel>
          </div>

          {/* Pitch log */}
          <Panel title="Pitch log" sub="every pitch · click a row to select it">
            <ScrollArea h={Math.min(440, 44 + pitches.length * 31)} viewportRef={logRef}>
              <Table fz="xs" verticalSpacing={4} highlightOnHover stickyHeader miw={1180}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>#</Table.Th>
                    {multiDay && <Table.Th>Date</Table.Th>}
                    <Table.Th>{pitches.some((p) => p.context) ? "Time / PA" : "Time"}</Table.Th>
                    <Table.Th>Pitch</Table.Th>
                    <Table.Th ta="right">Velo</Table.Th>
                    <Table.Th ta="right">Spin</Table.Th>
                    <Table.Th ta="right">IVB</Table.Th>
                    <Table.Th ta="right">HB</Table.Th>
                    <Table.Th ta="right">Tilt</Table.Th>
                    <Table.Th ta="right">Eff</Table.Th>
                    <Table.Th ta="right">Ext</Table.Th>
                    <Table.Th ta="right">Rel ht</Table.Th>
                    <Table.Th ta="right">Rel side</Table.Th>
                    <Table.Th ta="right">VAA</Table.Th>
                    <Table.Th ta="right">HAA</Table.Th>
                    <Table.Th ta="right">Plate ht</Table.Th>
                    <Table.Th ta="right">Plate side</Table.Th>
                    <Table.Th>Zone</Table.Th>
                    {hasResults && <Table.Th>Result</Table.Th>}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {pitches.map((p) => {
                    const sel = p.id === selectedId;
                    const z = zoneOf(p);
                    return (
                      <Table.Tr key={p.id} data-pid={p.id} onClick={() => select(p.id)}
                        style={{ cursor: "pointer", background: sel ? "rgba(255,255,255,0.1)" : undefined, boxShadow: sel ? `inset 3px 0 0 ${PITCH_COLORS[p.type]}` : undefined }}>
                        <Table.Td>{p.no}</Table.Td>
                        {multiDay && <Table.Td>{fmtDate(p.date)}</Table.Td>}
                        <Table.Td>{p.context ?? timeOnly(p.time) ?? "—"}</Table.Td>
                        <Table.Td><PitchDot code={p.type} />{PITCH_LABELS[p.type]}</Table.Td>
                        <Table.Td ta="right" fw={600}>{fmt(p.velo)}</Table.Td>
                        <Table.Td ta="right">{p.spin ?? "—"}</Table.Td>
                        <Table.Td ta="right">{fmt(p.ivb)}</Table.Td>
                        <Table.Td ta="right">{fmt(p.hbArm)}</Table.Td>
                        <Table.Td ta="right">{p.tilt ?? "—"}</Table.Td>
                        <Table.Td ta="right">{p.spinEff == null ? "—" : `${fmt(p.spinEff, 0)}%`}</Table.Td>
                        <Table.Td ta="right">{fmt(p.extension, 2)}</Table.Td>
                        <Table.Td ta="right">{fmt(p.relHeight, 2)}</Table.Td>
                        <Table.Td ta="right">{fmt(p.relSide, 2)}</Table.Td>
                        <Table.Td ta="right">{fmt(p.vaa)}</Table.Td>
                        <Table.Td ta="right">{fmt(p.haa)}</Table.Td>
                        <Table.Td ta="right">{fmt(p.plateHeight, 2)}</Table.Td>
                        <Table.Td ta="right">{fmt(p.plateSide, 2)}</Table.Td>
                        <Table.Td>{z === "zone" ? "In" : z === "edge" ? "Edge" : z === "out" ? "Out" : "—"}</Table.Td>
                        {hasResults && (
                          <Table.Td>
                            {p.result ? <Badge size="xs" variant="light" style={{ color: RESULT_COLORS[p.result] }}>{RESULT_LABELS[p.result]}</Badge> : "—"}
                          </Table.Td>
                        )}
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Panel>
          <Text size="xs" c="dimmed">
            Side measures are from the pitcher&apos;s view (+ = the pitcher&apos;s right), as TrackMan reports them; Savant values are converted to match.
            Movement and the HB column are arm side positive. Diamonds are pitch-type averages.
          </Text>
        </>
      )}
    </Stack>
  );
}
