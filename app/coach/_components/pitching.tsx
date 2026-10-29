"use client";

/** Pitch-data building blocks shared by the Pitching tab, Overview and Compare. */

import { useMemo, useState } from "react";
import { Badge, Group, ScrollArea, SegmentedControl, Table, Text, Tooltip } from "@mantine/core";
import {
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { PITCH_COLORS, PITCH_LABELS, type PitchCode } from "@/lib/pitch-intel/pitch-types";
import type { PitchTypeSummary, SessionSummary } from "@/lib/pitch-intel/sessions";
import type { VeloPoint } from "@/lib/coach/pitching";
import { fmt } from "./fetcher";

const AXIS_TICK = { fill: "rgba(255,255,255,0.5)", fontSize: 11 };
const GRID = "rgba(255,255,255,0.07)";
const TOOLTIP_STYLE = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: "0.78rem",
  color: "var(--text-primary)",
};

/** Whiff% per pitch type needs ~30 swings to mean much. */
export const WHIFF_MIN_SWINGS = 30;

/** xArsenal v3 (20-80, 50 = MLB average): Plus and up green, Average neutral, Fringe amber, Below red. */
export function gradeColor(score: number | null | undefined): string {
  if (score == null) return "gray";
  if (score >= 60) return "green";
  if (score >= 55) return "teal";
  if (score >= 45) return "gray";
  if (score >= 40) return "yellow";
  return "red";
}

/** 8-Stuff+ colors from the rules doc: green 110+, neutral 95–109, amber 85–94, red below 85. */
export function stuffColor(v: number | null | undefined): string {
  if (v == null) return "gray";
  if (v >= 110) return "green";
  if (v >= 95) return "gray";
  if (v >= 85) return "yellow";
  return "red";
}

export function ArsenalBadge({ arsenal, size = "lg" }: { arsenal: SessionSummary["arsenal"]; size?: "sm" | "md" | "lg" }) {
  if (!arsenal) return null;
  const tip = [
    `xArsenal ${arsenal.score} (${arsenal.label}) · graded as ${arsenal.compLevel}`,
    arsenal.fit != null ? `Arsenal Fit ${Math.round(arsenal.fit)}` : null,
    arsenal.slot?.angle != null ? `Arm slot ${Math.round(arsenal.slot.angle)}°${arsenal.slot.label ? ` (${arsenal.slot.label})` : ""}${arsenal.slot.source ? `, ${arsenal.slot.source}` : ""}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <Group gap={4} wrap="nowrap">
      <Tooltip label={tip} multiline maw={360}>
        <Badge color={gradeColor(arsenal.score)} variant="light" size={size}>
          Arsenal {arsenal.score} · {arsenal.label}
        </Badge>
      </Tooltip>
      {arsenal.stuffPlus != null && (
        <Tooltip label="Arsenal 8-Stuff+ (100 = average MLB arsenal)">
          <Badge color={stuffColor(arsenal.stuffPlus)} variant="outline" size={size}>
            8-Stuff+ {Math.round(arsenal.stuffPlus)}
          </Badge>
        </Tooltip>
      )}
    </Group>
  );
}

/** One pitch's xArsenal grade, with subtype, blend and top levers in the tooltip. */
export function PitchGradeBadge({ grade }: { grade: PitchTypeSummary["grade"] }) {
  if (!grade) return <>—</>;
  const mix = grade.subtypeMix
    ? Object.entries(grade.subtypeMix).sort((a, b) => b[1] - a[1]).map(([k, w]) => `${k} ${Math.round(w <= 1 ? w * 100 : w)}%`).join(", ")
    : null;
  const levers = grade.levers.slice(0, 3).map((l) => `${l.text ?? l.metric}${l.points != null ? ` (+${Math.round(l.points)})` : ""}`);
  return (
    <Tooltip multiline maw={340} label={
      <div>
        <div>{grade.subtype}{grade.label ? ` · ${grade.label}` : ""}</div>
        {mix && <div style={{ opacity: 0.8 }}>Blend: {mix}</div>}
        {levers.length > 0 && <div style={{ marginTop: 4 }}>Levers: {levers.join(" · ")}</div>}
      </div>
    }>
      <Badge size="sm" variant="light" color={gradeColor(grade.score)}>{grade.score}</Badge>
    </Tooltip>
  );
}

export function StuffPlusBadge({ grade }: { grade: PitchTypeSummary["grade"] }) {
  if (grade?.stuffPlus == null) return <>—</>;
  return (
    <Tooltip label={`8-Stuff+ ${Math.round(grade.stuffPlus)} vs. all MLB pitches${grade.stuffPlusType != null ? ` · ${Math.round(grade.stuffPlusType)} vs. its own type` : ""}`}>
      <Badge size="sm" variant="outline" color={stuffColor(grade.stuffPlus)}>{Math.round(grade.stuffPlus)}</Badge>
    </Tooltip>
  );
}

/** Add / drop / rework suggestions from the arsenal grade. */
export function ArsenalMoves({ arsenal }: { arsenal: SessionSummary["arsenal"] }) {
  if (!arsenal?.moves.length) return null;
  const color: Record<string, string> = { add: "green", drop: "red", rework: "yellow" };
  return (
    <div style={{ marginTop: 8 }}>
      <Text size="xs" c="dimmed" mb={4}>Arsenal moves</Text>
      {arsenal.moves.map((m, i) => (
        <Group key={i} gap={6} wrap="nowrap" align="flex-start" mb={2}>
          <Badge size="xs" variant="light" color={color[m.kind] ?? "gray"} style={{ flexShrink: 0 }}>{m.kind}</Badge>
          <Text size="xs"><b>{m.title}</b>{m.detail ? ` · ${m.detail}` : ""}</Text>
        </Group>
      ))}
    </div>
  );
}

export function PitchDot({ code }: { code: PitchCode }) {
  return <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 999, background: PITCH_COLORS[code], marginRight: 6, verticalAlign: "middle" }} />;
}

/** Per-pitch-type table: usage, velo, shape, release, whiff%, xArsenal grade, 8-Stuff+. */
export function PitchTypeTable({ rows, compact = false }: { rows: PitchTypeSummary[]; compact?: boolean }) {
  const show = {
    count: rows.some((r) => r.count != null),
    spin: rows.some((r) => r.spinRate != null),
    ext: !compact && rows.some((r) => r.extension != null),
    rel: !compact && rows.some((r) => r.relHeight != null),
    vaa: !compact && rows.some((r) => r.vaa != null),
    whiff: rows.some((r) => r.whiffPct != null),
    grade: rows.some((r) => r.grade != null),
    stuff: rows.some((r) => r.grade?.stuffPlus != null),
  };
  return (
    <ScrollArea>
      <Table fz="sm" verticalSpacing={4} miw={compact ? 520 : 820} highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Pitch</Table.Th>
            {show.count && <Table.Th ta="right">#</Table.Th>}
            <Table.Th ta="right">Usage</Table.Th>
            <Table.Th ta="right">Velo</Table.Th>
            {!compact && <Table.Th ta="right">Max</Table.Th>}
            {show.spin && <Table.Th ta="right">Spin</Table.Th>}
            <Table.Th ta="right">IVB</Table.Th>
            <Table.Th ta="right">HB (arm)</Table.Th>
            {show.vaa && <Table.Th ta="right">VAA</Table.Th>}
            {show.ext && <Table.Th ta="right">Ext</Table.Th>}
            {show.rel && <Table.Th ta="right">Rel ht / side</Table.Th>}
            {show.whiff && <Table.Th ta="right">Whiff%</Table.Th>}
            {show.grade && <Table.Th ta="right">xArsenal</Table.Th>}
            {show.stuff && <Table.Th ta="right">8-Stuff+</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.pitchType}>
              <Table.Td>
                <PitchDot code={r.pitchType} />
                {r.label}
              </Table.Td>
              {show.count && <Table.Td ta="right">{r.count ?? "—"}</Table.Td>}
              <Table.Td ta="right">{r.usagePct == null ? "—" : `${fmt(r.usagePct)}%`}</Table.Td>
              <Table.Td ta="right" fw={600}>{fmt(r.velo)}</Table.Td>
              {!compact && <Table.Td ta="right">{fmt(r.veloMax)}</Table.Td>}
              {show.spin && <Table.Td ta="right">{r.spinRate ?? "—"}</Table.Td>}
              <Table.Td ta="right">{fmt(r.ivb)}</Table.Td>
              <Table.Td ta="right">{fmt(r.hbArm)}</Table.Td>
              {show.vaa && <Table.Td ta="right">{fmt(r.vaa)}</Table.Td>}
              {show.ext && <Table.Td ta="right">{fmt(r.extension)}</Table.Td>}
              {show.rel && <Table.Td ta="right">{fmt(r.relHeight)} / {fmt(r.relSide)}</Table.Td>}
              {show.whiff && (
                <Table.Td ta="right">
                  {r.whiffPct == null ? "—" : `${fmt(r.whiffPct)}%`}
                  {r.whiffPct != null && r.swings != null && r.swings < WHIFF_MIN_SWINGS ? <span title={`${r.swings} swings`}>*</span> : null}
                </Table.Td>
              )}
              {show.grade && <Table.Td ta="right"><PitchGradeBadge grade={r.grade} /></Table.Td>}
              {show.stuff && <Table.Td ta="right"><StuffPlusBadge grade={r.grade} /></Table.Td>}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

type MovementPoint = { x: number; y: number; z: number; hbArm: number; code: PitchCode; label: string; velo: number | null; series: string };

/**
 * Pitch movement plot (IVB vs arm-side HB, inches). One dot per pitch type,
 * sized by usage, labeled with the pitch code. With several `sets` (compare
 * view) each set gets its own marker shape and a legend entry.
 *
 * Left-handers: the plot is mirrored so arm side sits on the left, the way a
 * lefty's break actually looks. Only the drawing flips — tick labels, tooltips
 * and tables keep the arm-side-positive values. A mixed-hand compare stays
 * unmirrored (one axis can't face both ways).
 */
export function MovementPlot({ sets, height = 320 }: { sets: Array<{ name: string; rows: PitchTypeSummary[]; throws?: "L" | "R" | null }>; height?: number }) {
  const shapes = ["circle", "diamond", "triangle", "square"] as const;
  const mirror = sets.length > 0 && sets.every((s) => s.throws === "L");
  const sx = mirror ? -1 : 1;
  const data = sets.map((s) =>
    s.rows
      .filter((r) => r.ivb != null && r.hbArm != null && r.pitchType !== "OTHER")
      .map<MovementPoint>((r) => ({ x: r.hbArm! * sx, y: r.ivb!, z: r.usagePct ?? 10, hbArm: r.hbArm!, code: r.pitchType, label: r.label, velo: r.velo, series: s.name })),
  );
  if (!data.some((d) => d.length)) {
    return <Text size="sm" c="dimmed">No movement data.</Text>;
  }
  const lim = Math.max(25, ...data.flat().map((p) => Math.ceil(Math.max(Math.abs(p.x), Math.abs(p.y)) / 5) * 5));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 10, right: 16, bottom: 20, left: 0 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis type="number" dataKey="x" domain={[-lim, lim]} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
          tickFormatter={(v: number) => String(v * sx + 0)}
          label={{ value: mirror ? "← arm side · horizontal break (in) · LHP" : "Horizontal break, arm side → (in)", position: "insideBottom", offset: -10, fill: "rgba(255,255,255,0.5)", fontSize: 11 }} />
        <YAxis type="number" dataKey="y" domain={[-lim, lim]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={36}
          label={{ value: "IVB (in)", angle: -90, position: "insideLeft", offset: 14, fill: "rgba(255,255,255,0.5)", fontSize: 11 }} />
        <ZAxis type="number" dataKey="z" range={[80, 420]} domain={[0, 60]} />
        <ReferenceLine x={0} stroke="rgba(255,255,255,0.18)" />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />
        <RTooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.2)" }}
          content={({ payload }) => {
            const p = payload?.[0]?.payload as MovementPoint | undefined;
            if (!p) return null;
            return (
              <div style={{ ...TOOLTIP_STYLE, padding: "6px 10px" }}>
                <div style={{ fontWeight: 600 }}>
                  <PitchDot code={p.code} />
                  {p.label}
                  {sets.length > 1 ? ` · ${p.series}` : ""}
                </div>
                <div>IVB {fmt(p.y)} in · HB {fmt(p.hbArm)} in</div>
                <div>{fmt(p.velo)} mph · {fmt(p.z)}% usage</div>
              </div>
            );
          }}
        />
        {sets.length > 1 && <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />}
        {data.map((points, i) => (
          <Scatter
            key={sets[i]!.name}
            name={sets[i]!.name}
            data={points}
            shape={shapes[i % shapes.length]}
            fill="rgba(255,255,255,0.7)"
            isAnimationActive={false}
          >
            {points.map((p, j) => (
              <Cell key={j} fill={PITCH_COLORS[p.code]} stroke="var(--bg-secondary)" strokeWidth={2} />
            ))}
            <LabelList dataKey="code" position="right" style={{ fill: "var(--text-secondary)", fontSize: 11 }} />
          </Scatter>
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

const FASTBALLS: PitchCode[] = ["FF", "SI"];

/**
 * Velocity by date, one line per pitch type. Fastballs by default; "All" adds
 * the rest. Source filter splits games (Savant + Trackman games) from bullpens.
 */
export function VeloTrendChart({ points, height = 280, defaultTypes = "fastballs" }: { points: VeloPoint[]; height?: number; defaultTypes?: "fastballs" | "all" }) {
  const [types, setTypes] = useState<string>(defaultTypes);
  const [source, setSource] = useState<string>("all");
  const hasBullpens = points.some((p) => p.sessionType === "bullpen");

  const { rows, codes } = useMemo(() => {
    const filtered = points.filter(
      (p) =>
        (types === "all" ? p.pitchType !== "OTHER" : FASTBALLS.includes(p.pitchType)) &&
        (source === "all" || p.sessionType === source),
    );
    const byDate = new Map<string, Record<string, number | string>>();
    const seen = new Set<PitchCode>();
    for (const p of filtered) {
      const row = byDate.get(p.date) ?? { date: p.date };
      // Same date from two sources: keep the one with more pitches.
      const nKey = `${p.pitchType}__n`;
      if (row[p.pitchType] == null || Number(row[nKey] ?? 0) < p.n) {
        row[p.pitchType] = p.velo;
        row[nKey] = p.n;
      }
      byDate.set(p.date, row);
      seen.add(p.pitchType);
    }
    const order: PitchCode[] = ["FF", "SI", "FC", "SL", "ST", "CU", "KC", "CH", "FS"];
    return { rows: [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))), codes: order.filter((c) => seen.has(c)) };
  }, [points, types, source]);

  return (
    <div>
      <Group gap="sm" mb="sm">
        <SegmentedControl size="xs" value={types} onChange={setTypes} data={[{ value: "fastballs", label: "Fastballs" }, { value: "all", label: "All pitches" }]} />
        {hasBullpens && (
          <SegmentedControl size="xs" value={source} onChange={setSource} data={[{ value: "all", label: "All" }, { value: "game", label: "Games" }, { value: "bullpen", label: "Bullpens" }]} />
        )}
      </Group>
      {rows.length === 0 ? (
        <Text size="sm" c="dimmed">No velocity data for this filter.</Text>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={rows} margin={{ top: 8, right: 16, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.12)" }} minTickGap={24} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} domain={["dataMin - 2", "dataMax + 2"]} tickFormatter={(v: number) => v.toFixed(0)} />
            <RTooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => [`${Number(v).toFixed(1)} mph`, PITCH_LABELS[name as PitchCode] ?? String(name)]} />
            <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => PITCH_LABELS[v as PitchCode] ?? v} />
            {codes.map((c) => (
              <Line key={c} type="linear" dataKey={c} name={c} stroke={PITCH_COLORS[c]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
