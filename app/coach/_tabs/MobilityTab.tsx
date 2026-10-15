"use client";

/**
 * Mobility tab.
 * - One session: the category list as before, with a percentile ring per
 *   category; "Show details" opens the components, each with its value and
 *   percentile.
 * - Several sessions: a line chart of each category's percentile over time;
 *   "Show details" opens one raw-value chart per component, with R/L (and
 *   dominant/non-dominant) pairs on one chart in red/blue. A chart only has
 *   points on dates that metric was measured, so a two-metric re-check adds two
 *   points to those charts and nothing to the rest. A "Session" view shows the
 *   single-session layout for any date.
 */

import { Fragment, useMemo, useState } from "react";
import useSWR from "swr";
import { Alert, Group, Loader, SegmentedControl, Select, Text } from "@mantine/core";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import type { MobilityChart, MobilityComponent, MobilityGroupHistory, MobilityHistory, MobilitySide, MobilityUnit } from "@/lib/coach/mobility";
import { condenseMobilityOptimalRange, getMobilityRangeColor } from "@/app/dashboard/athlete-tracking/domainHelpers";
import { fmtDate, swrOpts } from "../_components/fetcher";

const AXIS_TICK = { fill: "rgba(255,255,255,0.5)", fontSize: 10 };
const GRID = "rgba(255,255,255,0.07)";
const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: "0.78rem",
  color: "var(--text-primary)",
  padding: "6px 10px",
};
/** Validated on the dark card surface (dataviz validator: CVD ΔE 21, contrast ≥ 3:1). */
const SIDE_COLOR: Record<MobilitySide, string> = { R: "#f05252", Dom: "#f05252", L: "#4a90e2", NonDom: "#4a90e2" };
/** Category percentile line. */
const GROUP_COLOR = "#2c99d4";
/** Single-component detail charts: neutral, so it never reads as the L (blue) side. */
const SINGLE_COLOR = "#9fb3c8";

export const mobilityKey = (uuid: string) => `/api/coach/athletes/${encodeURIComponent(uuid)}/mobility`;

const pctColor = (p: number) => (p < 33 ? "var(--accent-red)" : p < 67 ? "var(--accent-yellow)" : "var(--accent-green)");

export function ordinal(n: number): string {
  const r = Math.round(n);
  const s = r % 100 >= 11 && r % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[r % 10] ?? "th";
  return `${r}${s}`;
}

export function formatMobilityValue(v: number | null | undefined, unit: MobilityUnit): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const n = Number.isInteger(v) ? String(v) : v.toFixed(1);
  switch (unit) {
    case "deg": return `${n}°`;
    case "grade": return `${n}/3`;
    case "posneg": return v <= 0 ? "Negative" : "Positive";
    case "lbs": return `${n} lb`;
    default: return n;
  }
}

const UNIT_NOTE: Record<MobilityUnit, string> = { deg: "degrees", grade: "1–3 grade", posneg: "negative / positive", force: "dynamometer", lbs: "lb", number: "" };

/** Radial bar: the percentile as an arc from 12 o'clock, the number inside. */
function PercentileRing({ pct, size = 58 }: { pct: number | null; size?: number }) {
  const r = 50;
  const stroke = 10;
  const mid = r - stroke / 2;
  const circ = 2 * Math.PI * mid;
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: "block", flexShrink: 0 }} role="img"
      aria-label={pct == null ? "No percentile" : `${ordinal(p)} percentile`}>
      <circle cx={50} cy={50} r={mid} fill="none" stroke="var(--bg-tertiary)" strokeWidth={stroke} />
      {pct != null && p > 0 && (
        <circle cx={50} cy={50} r={mid} fill="none" stroke={pctColor(p)} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(p / 100) * circ} ${circ}`} transform="rotate(-90 50 50)" />
      )}
      <text x={50} y={pct == null ? 50 : 47} textAnchor="middle" dominantBaseline="central" fill="var(--text-primary)" fontSize={pct == null ? 22 : 27} fontWeight={700}>
        {pct == null ? "—" : Math.round(p)}
      </text>
      {pct != null && (
        <text x={50} y={70} textAnchor="middle" dominantBaseline="central" fill="var(--text-secondary)" fontSize={12}>%ile</text>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Session view (single session, or any date picked in the multi-session view)
// ---------------------------------------------------------------------------

function ComponentPill({ c, date }: { c: MobilityComponent; date: string }) {
  const pt = c.points.find((p) => p.date === date);
  const shortRange = condenseMobilityOptimalRange(c.key, c.optimalRange);
  const border = pt ? getMobilityRangeColor(pt.rangeScore ?? (c.unit === "force" ? pt.percentile : null)) : "var(--border)";
  return (
    <div
      title={pt?.percentile != null ? `${ordinal(pt.percentile)} percentile of ${c.populationN} athletes` : undefined}
      style={{
        border: `1px solid ${border}`, borderRadius: 999, background: "var(--bg-tertiary)", padding: "6px 10px",
        display: "flex", alignItems: "center", gap: "0.55rem", minWidth: 0, overflow: "hidden", opacity: pt ? 1 : 0.5,
      }}
    >
      <span style={{ color: "var(--text-secondary)", fontSize: "0.84rem", flex: "1 1 0", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {c.label}
      </span>
      <strong style={{ fontSize: "0.9rem", flexShrink: 0, whiteSpace: "nowrap" }}>{pt ? formatMobilityValue(pt.value, c.unit) : "not measured"}</strong>
      {pt?.percentile != null && (
        <span style={{ fontSize: "0.75rem", flexShrink: 0, whiteSpace: "nowrap", color: "var(--text-primary)", background: "var(--bg-elevated)", borderRadius: 999, padding: "1px 7px" }}>
          {ordinal(pt.percentile)}
        </span>
      )}
      {pt && shortRange ? <span style={{ color: "var(--text-muted)", fontSize: "0.75rem", flexShrink: 0, whiteSpace: "nowrap" }}>{shortRange}</span> : null}
    </div>
  );
}

function SessionView({ data, date }: { data: MobilityHistory; date: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const session = data.sessions.find((s) => s.date === date);
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <Text size="sm" c="dimmed" mb="md">
        Session {fmtDate(date)}
        {session?.partial ? ` · re-check (${session.measured} metric${session.measured === 1 ? "" : "s"})` : ""}
        {" · "}percentile = average of the measured components&apos; percentiles vs {data.populationN} athletes
      </Text>
      {data.groups.map((g, idx) => {
        const pt = g.points.find((p) => p.date === date);
        const measured = g.components.filter((c) => c.points.some((p) => p.date === date));
        const isOpen = !!open[g.name];
        return (
          <Fragment key={g.name}>
            {idx > 0 && <div style={{ borderTop: "1px solid var(--border)" }} />}
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "0.6rem 1.5rem", opacity: measured.length ? 1 : 0.55 }}>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "0.55rem" }}>
                <span style={{ fontSize: "1.05rem", fontWeight: 700 }}>{g.name}</span>
                {measured.length > 0 && (
                  <button type="button" className="btn-ghost" style={{ fontSize: "0.72rem", padding: "2px 8px", lineHeight: 1.2 }}
                    onClick={() => setOpen((o) => ({ ...o, [g.name]: !o[g.name] }))}>
                    {isOpen ? "Hide details" : "Show details"}
                  </button>
                )}
                <Text span size="xs" c="dimmed">
                  {measured.length ? `${measured.length} of ${g.components.length} measured` : "not measured this session"}
                </Text>
              </div>
              <PercentileRing pct={pt?.percentile ?? null} />
            </div>
            {isOpen && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "0.55rem 0.75rem", padding: "0 1.5rem 0.9rem" }}>
                {g.components.map((c) => <ComponentPill key={c.key} c={c} date={date} />)}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trends view (several sessions)
// ---------------------------------------------------------------------------

type Row = { date: string } & Record<string, number | string | null>;

function GroupPercentileChart({ g }: { g: MobilityGroupHistory }) {
  const rows = g.points.map((p) => ({ date: p.date, pct: Math.round(p.percentile), measured: p.measured }));
  return (
    <ResponsiveContainer width="100%" height={190}>
      <LineChart data={rows} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="date" type="category" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
          tickFormatter={(d: string) => fmtDate(d)} padding={{ left: 18, right: 18 }} minTickGap={8} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
        <ReferenceLine y={50} stroke="rgba(255,255,255,0.18)" strokeDasharray="4 4" />
        <RTooltip
          cursor={{ stroke: "rgba(255,255,255,0.2)" }}
          content={({ payload }) => {
            const r = payload?.[0]?.payload as (typeof rows)[number] | undefined;
            if (!r) return null;
            return (
              <div style={TOOLTIP_STYLE}>
                <div style={{ fontWeight: 600 }}>{fmtDate(r.date)}</div>
                <div>{ordinal(r.pct)} percentile</div>
                <div style={{ opacity: 0.6 }}>average of {r.measured} component{r.measured === 1 ? "" : "s"}</div>
              </div>
            );
          }}
        />
        <Line dataKey="pct" stroke={GROUP_COLOR} strokeWidth={2} dot={{ r: 4, strokeWidth: 0, fill: GROUP_COLOR }} activeDot={{ r: 6 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ComponentChart({ chart, byKey }: { chart: MobilityChart; byKey: Map<string, MobilityComponent> }) {
  const comps = chart.series.map((s) => byKey.get(s.key)).filter((c): c is MobilityComponent => !!c);
  // x-axis = only the dates this chart's metrics were measured
  const dates = [...new Set(comps.flatMap((c) => c.points.map((p) => p.date)))].sort();
  const rows: Row[] = dates.map((date) => {
    const row: Row = { date };
    for (const c of comps) {
      const p = c.points.find((x) => x.date === date);
      row[c.key] = p?.value ?? null;
      row[`${c.key}__pct`] = p?.percentile ?? null;
    }
    return row;
  });
  const unit = chart.unit;
  const yProps =
    unit === "grade" ? { domain: [1, 3] as [number, number], ticks: [1, 2, 3] }
    : unit === "posneg" ? { domain: [0, 1] as [number, number], ticks: [0, 1], tickFormatter: (v: number) => (v <= 0 ? "Neg" : "Pos") }
    : { domain: ["auto", "auto"] as [string, string] };
  const colorFor = (i: number) => (chart.series[i]?.side ? SIDE_COLOR[chart.series[i]!.side!] : SINGLE_COLOR);

  return (
    <div style={{ background: "var(--bg-inset)", border: "1px solid var(--border-soft)", borderRadius: 8, padding: "8px 10px 4px" }}>
      <Group justify="space-between" gap={6} mb={2} wrap="nowrap">
        <Text size="sm" fw={600} truncate>
          {chart.title} {UNIT_NOTE[unit] && <Text span size="xs" c="dimmed">({UNIT_NOTE[unit]})</Text>}
        </Text>
        {chart.series.length > 1 && (
          <Group gap={10} wrap="nowrap">
            {chart.series.map((s, i) => (
              <Group key={s.key} gap={4} wrap="nowrap">
                <span style={{ width: 10, height: 10, borderRadius: 999, background: colorFor(i), display: "inline-block" }} />
                <Text size="xs" c="dimmed">{s.label}</Text>
              </Group>
            ))}
          </Group>
        )}
      </Group>
      {!rows.length ? (
        <Text size="xs" c="dimmed" py="md">Not measured yet.</Text>
      ) : (
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={rows} margin={{ top: 6, right: 10, left: -14, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="date" type="category" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
              tickFormatter={(d: string) => fmtDate(d)} padding={{ left: 14, right: 14 }} minTickGap={8} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} allowDecimals={unit !== "grade"} {...yProps} />
            <RTooltip
              cursor={{ stroke: "rgba(255,255,255,0.2)" }}
              content={({ payload }) => {
                const r = payload?.[0]?.payload as Row | undefined;
                if (!r) return null;
                return (
                  <div style={TOOLTIP_STYLE}>
                    <div style={{ fontWeight: 600 }}>{fmtDate(r.date)}</div>
                    {comps.map((c, i) => {
                      const v = r[c.key] as number | null;
                      const p = r[`${c.key}__pct`] as number | null;
                      return (
                        <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: colorFor(i), display: "inline-block" }} />
                          <span>{chart.series.length > 1 ? `${chart.series[i]!.label}: ` : ""}{v == null ? "not measured" : formatMobilityValue(v, unit)}</span>
                          {p != null && <span style={{ opacity: 0.6 }}>· {ordinal(p)} %ile</span>}
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            {comps.map((c, i) => (
              <Line key={c.key} dataKey={c.key} name={chart.series[i]!.label} stroke={colorFor(i)} strokeWidth={2} connectNulls
                dot={{ r: 4, strokeWidth: 2, stroke: "var(--bg-inset)", fill: colorFor(i) }} activeDot={{ r: 6 }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function TrendsView({ data }: { data: MobilityHistory }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {data.groups.map((g) => {
        const byKey = new Map(g.components.map((c) => [c.key, c]));
        const latest = g.points[g.points.length - 1];
        const isOpen = !!open[g.name];
        const charts = g.charts.filter((ch) => ch.series.some((s) => (byKey.get(s.key)?.points.length ?? 0) > 0));
        return (
          <div key={g.name} className="card" style={{ marginBottom: 0 }}>
            <Group justify="space-between" mb={4}>
              <Group gap="sm">
                <Text fw={700}>{g.name}</Text>
                {charts.length > 0 && (
                  <button type="button" className="btn-ghost" style={{ fontSize: "0.72rem", padding: "2px 8px", lineHeight: 1.2 }}
                    onClick={() => setOpen((o) => ({ ...o, [g.name]: !o[g.name] }))}>
                    {isOpen ? "Hide details" : "Show details"}
                  </button>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                {latest ? `${g.points.length} session${g.points.length === 1 ? "" : "s"} · latest ${ordinal(latest.percentile)} %ile (${fmtDate(latest.date)})` : "not measured"}
              </Text>
            </Group>
            {g.points.length > 1 && <GroupPercentileChart g={g} />}
            {g.points.length === 1 && latest && (
              // One point isn't a trend: show the ring instead of a near-empty chart.
              <Group gap="sm" py={4}>
                <PercentileRing pct={latest.percentile} size={52} />
                <Text size="sm" c="dimmed">Measured once ({fmtDate(latest.date)}) — a trend line appears after the next session that tests it.</Text>
              </Group>
            )}
            {isOpen && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10, marginTop: 10 }}>
                {charts.map((ch) => <ComponentChart key={ch.id} chart={ch} byKey={byKey} />)}
              </div>
            )}
          </div>
        );
      })}
      <Text size="xs" c="dimmed">
        Category line: average percentile of the components measured that session, against every athlete&apos;s latest value ({data.populationN} athletes); dashed line = 50th.
        Detail charts show raw values; each chart only has points on dates that metric was measured.
      </Text>
    </div>
  );
}

export function MobilityTab({ athleteUuid }: { athleteUuid: string }) {
  const { data, error, isLoading } = useSWR<MobilityHistory>(mobilityKey(athleteUuid), swrOpts);
  const [view, setView] = useState<"trends" | "session">("trends");
  const [pick, setPick] = useState<string | null>(null);
  const newestFirst = useMemo(() => [...(data?.sessions ?? [])].reverse(), [data]);

  if (isLoading) return <Loader size="sm" />;
  if (error) return <Alert color="red">{error.message}</Alert>;
  if (!data || !data.sessions.length) return <Text c="dimmed">No mobility assessments yet.</Text>;

  if (data.sessions.length === 1) return <SessionView data={data} date={data.sessions[0]!.date} />;

  const date = pick && data.sessions.some((s) => s.date === pick) ? pick : newestFirst[0]!.date;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Group gap="sm">
        <SegmentedControl value={view} onChange={(v) => setView(v as "trends" | "session")}
          data={[{ value: "trends", label: "Trends" }, { value: "session", label: "Session" }]} />
        {view === "session" && (
          <Select size="sm" w={260} value={date} onChange={(v) => v && setPick(v)} allowDeselect={false}
            data={newestFirst.map((s) => ({ value: s.date, label: `${fmtDate(s.date)}${s.partial ? ` · re-check (${s.measured})` : ""}` }))} />
        )}
        <Text size="sm" c="dimmed">{data.sessions.length} sessions</Text>
      </Group>
      {view === "trends" ? <TrendsView data={data} /> : <SessionView data={data} date={date} />}
    </div>
  );
}
