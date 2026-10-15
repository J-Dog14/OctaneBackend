"use client";

/**
 * Trends: every pitch metric over time, one small chart per metric, one line
 * per pitch type. Each point is that day's average (sessions of the selected
 * kind combined, weighted by pitch count). Pitch types and bullpens/games are
 * filterable, the date range can be a preset or hand-picked sessions, and the
 * x axis can be true time or evenly spaced sessions (so two 2024 sessions and
 * five 2026 ones aren't separated by a wide empty gap). Click a chart to enlarge it.
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Alert, Button, Checkbox, Chip, Group, Loader, Popover, ScrollArea, SegmentedControl, Stack, Text, UnstyledButton } from "@mantine/core";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { PITCH_CODES, PITCH_COLORS, PITCH_LABELS, type PitchCode } from "@/lib/pitch-intel/pitch-types";
import type { TrendPoint } from "@/lib/coach/pitchLog";
import { fmtDate, swrOpts } from "./fetcher";
import { PitchDot } from "./pitching";

const AXIS_TICK = { fill: "rgba(255,255,255,0.5)", fontSize: 10 };
const GRID = "rgba(255,255,255,0.07)";
const TOOLTIP_STYLE = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: "0.78rem",
  color: "var(--text-primary)",
};

type MetricKey = "velo" | "veloMax" | "spin" | "ivb" | "hbArm" | "extension" | "relHeight" | "relSide" | "vaa" | "haa" | "spinEff" | "gyro";

const METRICS: Array<{ key: MetricKey; label: string; unit: string; digits: number; note?: string }> = [
  { key: "velo", label: "Velocity", unit: "mph", digits: 1 },
  { key: "veloMax", label: "Max velocity", unit: "mph", digits: 1 },
  { key: "spin", label: "Spin rate", unit: "rpm", digits: 0 },
  { key: "ivb", label: "Induced vertical break", unit: "in", digits: 1 },
  { key: "hbArm", label: "Horizontal break", unit: "in", digits: 1, note: "arm side +" },
  { key: "extension", label: "Extension", unit: "ft", digits: 2 },
  { key: "relHeight", label: "Release height", unit: "ft", digits: 2 },
  { key: "relSide", label: "Release side", unit: "ft", digits: 2, note: "pitcher's view" },
  { key: "vaa", label: "Vertical approach angle", unit: "°", digits: 1 },
  { key: "haa", label: "Horizontal approach angle", unit: "°", digits: 1 },
  { key: "spinEff", label: "Spin efficiency", unit: "%", digits: 0, note: "Trackman" },
  { key: "gyro", label: "Gyro degree", unit: "°", digits: 1, note: "Trackman portal" },
];

type Kind = "all" | "bullpen" | "game";
type SeriesPt = { t: number; x: number; date: string; v: number | null; n: number };

const DAY = 86_400_000;
/** Breaks longer than this get a faint divider in evenly-spaced mode (time is compressed there). */
const GAP_DAYS = 90;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Calendar-aligned ticks: weeks, months, quarters or years depending on the span. */
function timeTicks(lo: number, hi: number): number[] {
  const spanDays = (hi - lo) / DAY;
  if (spanDays <= 0) return [lo];
  if (spanDays <= 75) {
    const out: number[] = [];
    for (let t = lo; t <= hi; t += 7 * DAY) out.push(t);
    return out;
  }
  const step = spanDays > 1460 ? 12 : spanDays > 730 ? 6 : spanDays > 300 ? 3 : 1;
  const d = new Date(lo);
  let y = d.getUTCFullYear();
  let m = Math.ceil(d.getUTCMonth() / step) * step;
  const out: number[] = [];
  for (;;) {
    while (m >= 12) { m -= 12; y += 1; }
    const t = Date.UTC(y, m, 1);
    if (t > hi) break;
    if (t >= lo) out.push(t);
    m += step;
  }
  return out;
}

function tickDate(t: number, spanDays: number): string {
  const d = new Date(t);
  const mon = MONTHS[d.getUTCMonth()]!;
  return spanDays > 300 ? `${mon} '${String(d.getUTCFullYear()).slice(2)}` : `${mon} ${d.getUTCDate()}`;
}
type Range = "all" | "365" | "90" | "custom";
type XMode = "time" | "even";

const KIND_LABEL: Record<string, string> = { bullpen: "Bullpen", game: "Game" };

/** Evenly spaced mode: label at most ~10 sessions so ticks don't collide. */
function evenTicks(n: number): number[] {
  if (n <= 12) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil(n / 10);
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  if (out[out.length - 1] !== n - 1) out.push(n - 1);
  return out;
}

export function MetricTrends({ athleteUuid }: { athleteUuid: string }) {
  const { data, error, isLoading } = useSWR<{ points: TrendPoint[] }>(
    `/api/coach/athletes/${encodeURIComponent(athleteUuid)}/pitches/trends`, swrOpts,
  );
  const [kind, setKind] = useState<Kind>("all");
  const [rangePick, setRange] = useState<Range | null>(null);
  const [off, setOff] = useState<Set<PitchCode>>(new Set());
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [xMode, setXMode] = useState<XMode>("time");
  const [big, setBig] = useState<MetricKey | null>(null);

  const points = useMemo(() => data?.points ?? [], [data]);
  // Default to the last 12 months when there's anything in them (a long history
  // squeezes recent sessions into a sliver); the coach can switch to All time.
  const yearAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 365);
    return d.toISOString().slice(0, 10);
  }, []);
  const range: Range = rangePick ?? (points.some((p) => p.date >= yearAgo) && points.some((p) => p.date < yearAgo) ? "365" : "all");
  const cutoff = useMemo(() => {
    if (range === "all" || range === "custom") return "";
    const d = new Date();
    d.setDate(d.getDate() - Number(range));
    return d.toISOString().slice(0, 10);
  }, [range]);
  // Every session day of the chosen kind (newest first) for the "Select sessions" picker.
  const sessions = useMemo(() => {
    const m = new Map<string, { date: string; n: number; kinds: Set<string>; sources: Set<string> }>();
    for (const p of points) {
      if (p.type === "OTHER" || (kind !== "all" && p.kind !== kind)) continue;
      const s = m.get(p.date) ?? { date: p.date, n: 0, kinds: new Set<string>(), sources: new Set<string>() };
      s.n += p.n;
      s.kinds.add(p.kind);
      s.sources.add(p.source);
      m.set(p.date, s);
    }
    return [...m.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [points, kind]);
  const filtered = useMemo(
    () => points.filter((p) => p.type !== "OTHER" && (kind === "all" || p.kind === kind)
      && (range === "custom" ? picked?.has(p.date) ?? false : p.date >= cutoff)),
    [points, kind, cutoff, range, picked],
  );
  const types = useMemo(() => PITCH_CODES.filter((c) => c !== "OTHER" && filtered.some((p) => p.type === c)), [filtered]);
  const shown = types.filter((t) => !off.has(t));

  /**
   * Per metric, per pitch type: one point per day (sessions of the chosen kind
   * that day, weighted by pitches; max for max velo). Lines connect across any
   * gap in time — every session that's there is joined to the next one.
   */
  const { byMetric, span, days } = useMemo(() => {
    const out = new Map<MetricKey, Map<PitchCode, SeriesPt[]>>();
    let lo = Infinity;
    let hi = -Infinity;
    for (const m of METRICS) {
      const acc = new Map<string, { sum: number; n: number; max: number }>();
      for (const p of filtered) {
        const v = p[m.key];
        if (v == null || !Number.isFinite(v)) continue;
        const k = `${p.type}|${p.date}`;
        const a = acc.get(k) ?? { sum: 0, n: 0, max: -Infinity };
        a.sum += v * p.n;
        a.n += p.n;
        a.max = Math.max(a.max, v);
        acc.set(k, a);
      }
      const series = new Map<PitchCode, SeriesPt[]>();
      for (const [k, a] of acc) {
        const [type, date] = k.split("|") as [PitchCode, string];
        const t = Date.parse(`${date}T12:00:00Z`);
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
        const arr = series.get(type) ?? [];
        arr.push({ t, x: 0, date, v: m.key === "veloMax" ? a.max : a.sum / a.n, n: a.n });
        series.set(type, arr);
      }
      for (const arr of series.values()) arr.sort((x, y) => x.t - y.t);
      out.set(m.key, series);
    }
    // Evenly spaced x: one slot per session day, shared by every chart so they line up.
    const days = [...new Set([...out.values()].flatMap((s) => [...s.values()].flat().map((p) => p.date)))].sort();
    const slot = new Map(days.map((d, i) => [d, i]));
    for (const s of out.values()) for (const arr of s.values()) for (const p of arr) p.x = slot.get(p.date)!;
    return { byMetric: out, span: Number.isFinite(lo) ? ([lo, hi] as [number, number]) : null, days };
  }, [filtered]);

  if (isLoading) return <Loader size="sm" />;
  if (error) return <Alert color="red">{error.message}</Alert>;
  if (!points.length) return <Text c="dimmed">No pitch data to trend yet.</Text>;

  const metrics = METRICS.filter((m) => shown.some((t) => (byMetric.get(m.key)?.get(t) ?? []).some((p) => p.v != null)));
  const spanDays = span ? (span[1] - span[0]) / DAY : 0;
  const pad = span ? Math.max(3 * DAY, (span[1] - span[0]) * 0.02) : 0;
  const even = xMode === "even";
  const domain: [number, number] = even ? [-0.5, Math.max(days.length - 0.5, 0.5)] : span ? [span[0] - pad, span[1] + pad] : [0, 1];
  const ticks = even ? evenTicks(days.length) : timeTicks(domain[0], domain[1]);
  const dayT = (i: number) => Date.parse(`${days[i] ?? days[0]}T12:00:00Z`);
  const fmtTick = (v: number) => {
    if (!even) return tickDate(v, spanDays);
    if (!days[v]) return "";
    const d = new Date(dayT(v));
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${spanDays > 300 ? ` '${String(d.getUTCFullYear()).slice(2)}` : ""}`;
  };
  // Evenly spaced mode squeezes time: mark long breaks with a faint divider.
  const breaks = even ? days.slice(1).flatMap((d, i) => (dayT(i + 1) - dayT(i) > GAP_DAYS * DAY ? [i + 0.5] : [])) : [];
  const pickedCount = sessions.filter((s) => picked?.has(s.date)).length;
  const setAll = (dates: string[]) => setPicked(new Set(dates));
  const ordered = big ? [...metrics.filter((m) => m.key === big), ...metrics.filter((m) => m.key !== big)] : metrics;

  return (
    <Stack gap="md">
      <Group gap="sm" wrap="wrap">
        <SegmentedControl value={kind} onChange={(v) => setKind(v as Kind)}
          data={[{ value: "all", label: "All" }, { value: "bullpen", label: "Bullpens" }, { value: "game", label: "Games" }]} />
        <SegmentedControl value={range}
          onChange={(v) => {
            if (v === "custom") {
              // Start from whatever the current preset shows.
              if (!picked) setPicked(new Set(sessions.filter((s) => s.date >= cutoff).map((s) => s.date)));
              setPickerOpen(true);
            }
            setRange(v as Range);
          }}
          data={[{ value: "all", label: "All time" }, { value: "365", label: "12 months" }, { value: "90", label: "90 days" }, { value: "custom", label: "Custom" }]} />
        {range === "custom" && (
          <Popover opened={pickerOpen} onChange={setPickerOpen} position="bottom-start" width={340} shadow="md" withArrow>
            <Popover.Target>
              <Button size="xs" variant="light" onClick={() => setPickerOpen((o) => !o)}>
                Select sessions ({pickedCount} of {sessions.length})
              </Button>
            </Popover.Target>
            <Popover.Dropdown>
              <Group gap={6} mb="xs">
                <Button size="compact-xs" variant="default" onClick={() => setAll(sessions.map((s) => s.date))}>All</Button>
                <Button size="compact-xs" variant="default" onClick={() => setAll([])}>None</Button>
                <Button size="compact-xs" variant="default" onClick={() => setAll(sessions.slice(0, 5).map((s) => s.date))}>Last 5</Button>
                <Button size="compact-xs" variant="default" onClick={() => setAll(sessions.slice(0, 10).map((s) => s.date))}>Last 10</Button>
              </Group>
              <ScrollArea.Autosize mah={320} type="auto">
                <Stack gap={4}>
                  {sessions.map((s) => (
                    <Checkbox key={s.date} size="xs" checked={picked?.has(s.date) ?? false}
                      onChange={() => setPicked((cur) => {
                        const n = new Set(cur ?? []);
                        if (n.has(s.date)) n.delete(s.date); else n.add(s.date);
                        return n;
                      })}
                      label={
                        <Text size="xs">
                          {fmtDate(s.date)} · {[...s.kinds].map((k) => KIND_LABEL[k] ?? k).join(" + ")}
                          <Text span size="xs" c="dimmed"> · {s.n} pitches · {[...s.sources].join(", ")}</Text>
                        </Text>
                      } />
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            </Popover.Dropdown>
          </Popover>
        )}
        <SegmentedControl value={xMode} onChange={(v) => setXMode(v as XMode)}
          data={[{ value: "time", label: "True dates" }, { value: "even", label: "Even spacing" }]} />
        <Group gap={6} ml="md">
          {types.map((t) => (
            <Chip key={t} size="xs" variant="outline" color="gray" checked={!off.has(t)}
              onChange={() => setOff((o) => {
                const n = new Set(o);
                if (n.has(t)) n.delete(t); else n.add(t);
                return n;
              })}>
              <PitchDot code={t} />
              {PITCH_LABELS[t]}
            </Chip>
          ))}
        </Group>
      </Group>
      {range === "custom" && !pickedCount ? (
        <Text c="dimmed">Pick at least one session.</Text>
      ) : !shown.length ? (
        <Text c="dimmed">Pick at least one pitch type.</Text>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 12 }}>
          {ordered.map((m) => {
            const series = byMetric.get(m.key);
            const isBig = big === m.key;
            return (
              <div key={m.key} className="card" style={{ marginBottom: 0, gridColumn: isBig ? "1 / -1" : undefined }}>
                <UnstyledButton onClick={() => setBig(isBig ? null : m.key)} style={{ width: "100%" }}>
                  <Group justify="space-between" mb={4}>
                    <Text fw={700} size="sm">
                      {m.label} <Text span size="xs" c="dimmed">({m.unit}{m.note ? ` · ${m.note}` : ""})</Text>
                    </Text>
                    <Text size="xs" c="dimmed">{isBig ? "click to shrink" : "click to enlarge"}</Text>
                  </Group>
                </UnstyledButton>
                <ResponsiveContainer width="100%" height={isBig ? 380 : 210}>
                  <LineChart margin={{ top: 6, right: 12, left: -4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                    <XAxis dataKey={even ? "x" : "t"} type="number" scale={even ? "linear" : "time"} domain={domain} tick={AXIS_TICK} tickLine={false}
                      axisLine={{ stroke: "rgba(255,255,255,0.12)" }} ticks={ticks} minTickGap={20} tickFormatter={fmtTick} allowDataOverflow />
                    {breaks.map((x) => <ReferenceLine key={x} x={x} stroke="rgba(255,255,255,0.18)" strokeDasharray="2 4" />)}
                    <YAxis dataKey="v" tick={AXIS_TICK} tickLine={false} axisLine={false} width={46} domain={["auto", "auto"]}
                      tickFormatter={(v: number) => v.toFixed(m.digits > 1 ? 1 : 0)} />
                    <RTooltip
                      shared={false}
                      contentStyle={TOOLTIP_STYLE}
                      content={({ payload }) => {
                        const item = payload?.[0];
                        const pt = item?.payload as SeriesPt | undefined;
                        if (!pt || pt.v == null) return null;
                        const t = String(item?.name) as PitchCode;
                        return (
                          <div style={{ ...TOOLTIP_STYLE, padding: "6px 10px" }}>
                            <div style={{ fontWeight: 600 }}><PitchDot code={t} />{PITCH_LABELS[t] ?? t}</div>
                            <div>{fmtDate(pt.date)} · {pt.v.toFixed(m.digits)} {m.unit}</div>
                            <div style={{ opacity: 0.6 }}>{pt.n} pitches</div>
                          </div>
                        );
                      }}
                    />
                    {shown.map((t) => (
                      <Line key={t} data={series?.get(t) ?? []} dataKey="v" name={t} stroke={PITCH_COLORS[t]} strokeWidth={2}
                        dot={{ r: isBig ? 3.5 : 2.5 }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      )}
      <Text size="xs" c="dimmed">
        One point per day per pitch type (all sessions of the chosen kind that day, weighted by pitches); lines join every session, however far apart.
        {even ? " Even spacing: one slot per session day; dotted dividers mark breaks of more than 90 days." : ""} Savant games and Trackman share each chart; Savant has no spin
        efficiency or gyro.
      </Text>
    </Stack>
  );
}
