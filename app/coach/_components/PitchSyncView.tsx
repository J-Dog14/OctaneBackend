"use client";

/**
 * "TM + 3D" tab: each 3D trial beside the TrackMan pitch it
 * was thrown as (paired by uais/python/trackman/match_3d.py). Coach hub only.
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Alert, Badge, Group, Loader, ScrollArea, SegmentedControl, Select, Stack, Table, Text, Tooltip } from "@mantine/core";
import { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { PITCH_COLORS, PITCH_LABELS, type PitchCode } from "@/lib/pitch-intel/pitch-types";
import type { LinkConfidence, MetricDef, PitchSyncData, SyncPitch } from "@/lib/coach/pitchSync";
import { PITCH_CATEGORY_LABEL, PITCH_CATEGORY_SHORT } from "@/lib/coach/biomech/pitchCategory";
import { fmt, fmtDate, swrOpts } from "./fetcher";
import { PitchDot, gradeColor } from "./pitching";
import { ArmFlightView } from "./ArmFlightView";
import { pitchNames, trialKey } from "./pitchSyncNames";
import { xaReason } from "./PitchMetricsPanel";

const AXIS_TICK = { fill: "rgba(255,255,255,0.5)", fontSize: 11 };
const GRID = "rgba(255,255,255,0.07)";
const TOOLTIP_STYLE = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: "0.78rem",
  color: "var(--text-primary)",
  padding: "6px 10px",
};

/** Same ids as pitchSync.ts MOVEMENT_IDS (kept here so the client bundle doesn't import server code). */
const MOVEMENT_IDS = new Set(["ivb", "hbArm", "spinAxis", "spinEff", "gyro", "vaa", "haa"]);

/** Flight columns shown in the table (the rest stay available on the chart) - keeps room for the mechanics columns. */
const TABLE_FLIGHT = ["velo", "spin", "ivb", "hbArm", "spinAxis"];

const CONFIDENCE: Record<LinkConfidence, { color: string; label: string; help: string }> = {
  exact: { color: "teal", label: "exact", help: "Velo, timing and pitch type all line up" },
  probable: { color: "blue", label: "probable", help: "Lines up, with one small mismatch (velo off by ≤ 0.1, or no 3D velo)" },
  review: { color: "orange", label: "review", help: "Paired, but check it: velo, timing or type doesn't fully agree" },
  manual: { color: "gray", label: "manual", help: "Paired by hand" },
};

const MECH_GROUPS = ["Forearm", "Arm", "Trunk", "Speed", "Body"] as const;

/** Wider than the page column (AthleteView is a centered 1280 column; the coach layout has no sidebar). */
const FULL_BLEED = { width: "min(1800px, calc(100vw - 48px))", position: "relative", left: "50%", transform: "translateX(-50%)" } as const;

function value(p: SyncPitch, id: string): number | null {
  if (id in p.mech) return p.mech[id] ?? null;
  return p.flight[id] ?? null;
}

function mean(xs: Array<number | null>, circular = false): number | null {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  if (!v.length) return null;
  if (!circular) return v.reduce((a, b) => a + b, 0) / v.length;
  // spin axis wraps at 360°: average the directions, not the numbers
  const rad = (d: number) => (d * Math.PI) / 180;
  const s = v.reduce((a, d) => a + Math.sin(rad(d)), 0);
  const c = v.reduce((a, d) => a + Math.cos(rad(d)), 0);
  return (((Math.atan2(s, c) * 180) / Math.PI) + 360) % 360;
}

/**
 * Two-line column header: "Hip–shoulder sep" / "@ footstrike °". Splits at " @ ", else before a
 * parenthesis or "+", else at the word break nearest the middle.
 */
function headerLines(label: string): [string, string] {
  const at = label.indexOf(" @ ");
  if (at > 0) return [label.slice(0, at), label.slice(at + 1)];
  for (const sep of [" (", " +", " → "]) {
    const i = label.indexOf(sep);
    if (i > 0) return [label.slice(0, i), label.slice(i + 1)];
  }
  const words = label.split(" ");
  if (words.length < 2) return [label, ""];
  let best = 1;
  let bestGap = Infinity;
  for (let i = 1; i < words.length; i++) {
    const gap = Math.abs(words.slice(0, i).join(" ").length - words.slice(i).join(" ").length);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

function HeaderLabel({ m }: { m: MetricDef }) {
  const [a, b] = headerLines(m.label);
  return (
    <span style={{ display: "inline-block", lineHeight: 1.2 }}>
      {a}
      <br />
      <Text span size="xs" c="dimmed" fw={500}>
        {b}
        {m.unit ? `${b ? " " : ""}${m.unit}` : ""}
      </Text>
    </span>
  );
}

function MetricCell({ v, def }: { v: number | null; def: MetricDef }) {
  return <Table.Td ta="right">{fmt(v, def.digits)}</Table.Td>;
}

export function PitchSyncView({ athleteUuid }: { athleteUuid: string }) {
  const [date, setDate] = useState<string | null>(null);
  const [group, setGroup] = useState<(typeof MECH_GROUPS)[number]>("Forearm");
  const [hidden, setHidden] = useState<Set<PitchCode>>(new Set());
  const [xId, setXId] = useState("proSupRelease");
  const [yId, setYId] = useState("spinAxis");
  // Shared selection between the arm + flight row and the table/chart below:
  // which pitches are drawn, and which one is highlighted (its numbers fill the metrics panel).
  const [picked, setPicked] = useState<string[] | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const key = `/api/coach/athletes/${encodeURIComponent(athleteUuid)}/pitch-sync${date ? `?date=${date}` : ""}`;
  const { data: d, error, isLoading } = useSWR<PitchSyncData>(key, { ...swrOpts, keepPreviousData: true });

  const rows = useMemo(() => {
    if (!d) return [];
    return [...d.pitches].sort((a, b) => (a.tm?.pitchNo ?? 1e9) - (b.tm?.pitchNo ?? 1e9) || a.captureOrder - b.captureOrder);
  }, [d]);
  const types = useMemo(() => {
    const seen: PitchCode[] = [];
    for (const r of rows) if (r.tm && !seen.includes(r.tm.code)) seen.push(r.tm.code);
    return seen;
  }, [rows]);
  const order = useMemo(() => rows.map(trialKey), [rows]);

  const names = useMemo(() => pitchNames(rows), [rows]);
  // Default: the first pitch thrown (also when the capture changes and the old pick isn't in it).
  const selected = (() => {
    const s = (picked ?? []).filter((k) => order.includes(k));
    return s.length ? s : order.slice(0, 1);
  })();
  const focusKey = focus && selected.includes(focus) ? focus : selected[0] ?? null;

  /** Arrows / table / chart: highlight that pitch; if it isn't already drawn, show just it. */
  const pickKey = (k: string) => {
    if (!(selected.length > 1 && selected.includes(k))) setPicked([k]);
    setFocus(k);
  };
  const pick = (r: SyncPitch) => {
    pickKey(trialKey(r));
    document.getElementById("arm-flight")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const select = (keys: string[]) => {
    const next = keys.length ? keys : focusKey ? [focusKey] : [];
    setPicked(next);
    if (focusKey && !next.includes(focusKey)) setFocus(next[0] ?? null);
  };

  if (isLoading && !d) return <Loader size="sm" />;
  if (error && !d) return <Alert color="red">{error.message}</Alert>;
  if (!d) return null;

  const flightDefs = new Map(d.flightMetrics.map((m) => [m.id, m]));
  const mechDefs = new Map(d.mechMetrics.map((m) => [m.id, m]));
  const tableFlight = TABLE_FLIGHT.map((id) => flightDefs.get(id)!).filter(Boolean);
  const tableMech = d.mechMetrics.filter((m) => m.group === group);
  const visible = rows.filter((r) => !r.tm || !hidden.has(r.tm.code));
  const paired = rows.filter((r) => r.tm);
  const unpaired = rows.length - paired.length;
  const toggle = (c: PitchCode) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });

  // Chart: paired pitches with both values; velo-only TrackMan reads drop out of movement/spin metrics.
  const xDef = mechDefs.get(xId) ?? flightDefs.get(xId);
  const yDef = flightDefs.get(yId) ?? mechDefs.get(yId);
  const chartPts = visible
    .filter((r) => r.tm)
    .map((r) => ({ x: value(r, xId), y: value(r, yId), r }))
    .filter((p): p is { x: number; y: number; r: SyncPitch } => p.x != null && p.y != null);
  const veloOnlyDropped = MOVEMENT_IDS.has(yId) ? visible.filter((r) => r.tm && !r.tm.hasMovement).length : 0;

  const typeMeans = types
    .filter((c) => !hidden.has(c))
    .map((c) => {
      const rs = paired.filter((r) => r.tm!.code === c);
      return { code: c, n: rs.length, rows: rs };
    });

  const metricOptions = (defs: MetricDef[]) => {
    const groups = [...new Set(defs.map((m) => m.group))];
    return groups.map((g) => ({ group: g, items: defs.filter((m) => m.group === g).map((m) => ({ value: m.id, label: `${m.label}${m.unit ? ` (${m.unit})` : ""}` })) }));
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="sm" c="dimmed">
            Each 3D trial next to the TrackMan pitch it was thrown as. {paired.length} of {rows.length} trials paired
            {d.tmPitchCount ? ` · ${d.tmPitchCount} live TrackMan pitches that day` : ""}
            {d.clockOffsetS != null ? ` · clocks ${Math.abs(Math.round(d.clockOffsetS))} s apart` : ""}
            {d.throws ? ` · ${d.throws === "L" ? "LHP" : "RHP"}` : ""}.
          </Text>
          <Text size="xs" c="dimmed">
            TM # = order thrown in the TrackMan session. Trial = 3D trial number within its pitch category. Breaking ball, off speed and untyped captures
            are coach hub only.
          </Text>
          {d.xaStatus && d.xaStatus.state !== "ok" && d.xaStatus.message && (
            <Text size="xs" c="orange" mt={2}>
              {d.xaStatus.message}
            </Text>
          )}
        </div>
        <Group gap="xs">
          {isLoading && <Loader size="xs" />}
          <Select
            size="xs"
            w={190}
            data={d.sessions.map((s) => ({ value: s, label: `Capture ${fmtDate(s)}` }))}
            value={d.sessionDate}
            onChange={(s) => s && setDate(s)}
            allowDeselect={false}
          />
        </Group>
      </Group>

      {/* ARM + FLIGHT + METRICS (top), as wide as the table */}
      <div style={FULL_BLEED}>
        <ArmFlightView
          athleteUuid={athleteUuid}
          date={d.sessionDate}
          pitches={rows}
          names={names}
          selected={selected}
          focusKey={focusKey}
          onPick={pickKey}
          onSelect={select}
          xaStatus={d.xaStatus ?? null}
        />
      </div>

      <div style={{ borderTop: "1px solid var(--border)" }} />

      {types.length > 1 && (
        <Group gap={6}>
          {types.map((c) => (
            <Badge
              key={c}
              variant={hidden.has(c) ? "outline" : "light"}
              color="gray"
              style={{ cursor: "pointer", opacity: hidden.has(c) ? 0.5 : 1, textTransform: "none" }}
              onClick={() => toggle(c)}
              leftSection={<PitchDot code={c} />}
            >
              {PITCH_LABELS[c]} ({paired.filter((r) => r.tm!.code === c).length})
            </Badge>
          ))}
        </Group>
      )}

      {/* PAIRED PITCH TABLE: wider than the page column so more mechanics fit */}
      <div style={FULL_BLEED}>
        <Group justify="space-between" mb={6}>
          <div>
            <Text fw={600}>Pitch by pitch</Text>
            <Text size="xs" c="dimmed">Click a pitch to show it in the arm + flight view above.</Text>
          </div>
          <SegmentedControl size="xs" value={group} onChange={(g) => setGroup(g as (typeof MECH_GROUPS)[number])} data={[...MECH_GROUPS]} />
        </Group>
        <ScrollArea>
          <Table fz="sm" verticalSpacing={5} highlightOnHover withColumnBorders={false} style={{ whiteSpace: "nowrap" }} stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ verticalAlign: "bottom" }} ta="right">TM #</Table.Th>
                <Table.Th style={{ verticalAlign: "bottom" }}>Pitch</Table.Th>
                <Table.Th style={{ verticalAlign: "bottom" }}>3D trial</Table.Th>
                <Table.Th style={{ verticalAlign: "bottom" }}>Pair</Table.Th>
                <Table.Th ta="right" style={{ verticalAlign: "bottom" }}>
                  <Tooltip label="xArsenal v3 for each single pitch (needs TrackMan's full read)" withArrow>
                    <span>xArsenal</span>
                  </Tooltip>
                </Table.Th>
                {tableFlight.map((m) => (
                  <Table.Th key={m.id} ta="right" style={{ verticalAlign: "bottom" }}>
                    <HeaderLabel m={m} />
                  </Table.Th>
                ))}
                {tableMech.map((m) => (
                  <Table.Th key={m.id} ta="right" style={{ borderLeft: m === tableMech[0] ? "1px solid var(--border)" : undefined, verticalAlign: "bottom" }}>
                    <Tooltip label={m.help ?? m.label} multiline w={280} withArrow>
                      <span>
                        <HeaderLabel m={m} />
                      </span>
                    </Tooltip>
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visible.map((r) => {
                const c = r.tm ? CONFIDENCE[r.tm.confidence] : null;
                const on = trialKey(r) === focusKey;
                const drawn = selected.includes(trialKey(r));
                return (
                  <Table.Tr
                    key={trialKey(r)}
                    onClick={() => pick(r)}
                    aria-selected={on}
                    style={{
                      cursor: "pointer",
                      opacity: r.tm?.confidence === "review" && !on ? 0.75 : 1,
                      background: on ? "rgba(255,255,255,0.09)" : drawn ? "rgba(255,255,255,0.035)" : undefined,
                      boxShadow: on ? `inset 3px 0 0 ${r.tm ? PITCH_COLORS[r.tm.code] : "#9aa4ab"}` : undefined,
                    }}
                  >
                    <Table.Td ta="right" fw={on ? 700 : undefined}>{r.tm?.pitchNo ?? "—"}</Table.Td>
                    <Table.Td>
                      {r.tm ? (
                        <>
                          <PitchDot code={r.tm.code} />
                          {PITCH_LABELS[r.tm.code]}
                          {r.tm.tilt ? <Text span size="xs" c="dimmed"> · {r.tm.tilt}</Text> : null}
                        </>
                      ) : (
                        <Text span size="sm" c="dimmed">No TrackMan pitch</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label={r.ownerFilename ?? ""} disabled={!r.ownerFilename} withArrow>
                        <span>
                          {PITCH_CATEGORY_SHORT[r.category]} #{r.trialIndex}
                          {r.category !== "fastball" && <Text span size="xs" c="dimmed"> {PITCH_CATEGORY_LABEL[r.category].one.toLowerCase()}</Text>}
                        </span>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      {c && r.tm && (
                        <Tooltip
                          multiline
                          w={260}
                          withArrow
                          label={`${c.help}${r.tm.residualS != null ? ` · timing ${r.tm.residualS >= 0 ? "+" : ""}${r.tm.residualS.toFixed(0)} s` : ""}${r.tm.notes ? ` · ${r.tm.notes}` : ""}`}
                        >
                          <Badge size="xs" variant="light" color={c.color} style={{ minWidth: 64, overflow: "visible" }}>
                            {c.label}
                          </Badge>
                        </Tooltip>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">
                      {r.tm?.xa?.score != null ? (
                        <Badge size="sm" variant="light" color={gradeColor(r.tm.xa.score)} style={{ minWidth: 40 }}>
                          {r.tm.xa.score}
                        </Badge>
                      ) : (
                        <Tooltip label={xaReason(r, d.xaStatus ?? null)} disabled={!r.tm} multiline w={260} withArrow>
                          <Text span size="sm" c="dimmed">—</Text>
                        </Tooltip>
                      )}
                    </Table.Td>
                    {tableFlight.map((m) => (
                      <MetricCell key={m.id} v={r.flight[m.id] ?? null} def={m} />
                    ))}
                    {tableMech.map((m) => (
                      <Table.Td key={m.id} ta="right" style={{ borderLeft: m === tableMech[0] ? "1px solid var(--border)" : undefined }}>
                        {fmt(r.mech[m.id] ?? null, m.digits)}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
            {typeMeans.length > 0 && (
              <Table.Tfoot>
                {typeMeans.map((t) => (
                  <Table.Tr key={t.code} style={{ fontWeight: 600, borderTop: "1px solid var(--border)" }}>
                    <Table.Td />
                    <Table.Td>
                      <PitchDot code={t.code} />
                      {PITCH_LABELS[t.code]} avg
                    </Table.Td>
                    <Table.Td>
                      <Text span size="xs" c="dimmed">n={t.n}</Text>
                    </Table.Td>
                    <Table.Td />
                    <Table.Td ta="right">{fmt(mean(t.rows.map((r) => r.tm?.xa?.score ?? null)), 0)}</Table.Td>
                    {tableFlight.map((m) => (
                      <MetricCell key={m.id} v={mean(t.rows.map((r) => r.flight[m.id] ?? null), m.id === "spinAxis")} def={m} />
                    ))}
                    {tableMech.map((m) => (
                      <Table.Td key={m.id} ta="right" style={{ borderLeft: m === tableMech[0] ? "1px solid var(--border)" : undefined }}>
                        {fmt(mean(t.rows.map((r) => r.mech[m.id] ?? null)), m.digits)}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tfoot>
            )}
          </Table>
        </ScrollArea>
        {unpaired > 0 && (
          <Text size="xs" c="dimmed" mt={4}>
            {unpaired} 3D trial{unpaired === 1 ? " has" : "s have"} no TrackMan pitch: no ball flight for {unpaired === 1 ? "it" : "them"}.
          </Text>
        )}
      </div>

      {/* MECHANICS vs BALL FLIGHT */}
      <div>
        <Group justify="space-between" mb={6} align="flex-end">
          <Text fw={600}>Mechanics vs ball flight</Text>
          <Group gap="xs">
            <Select size="xs" w={260} label="Mechanics (x)" data={metricOptions(d.mechMetrics)} value={xId} onChange={(v) => v && setXId(v)} allowDeselect={false} searchable />
            <Select size="xs" w={230} label="Ball flight (y)" data={metricOptions(d.flightMetrics)} value={yId} onChange={(v) => v && setYId(v)} allowDeselect={false} searchable />
          </Group>
        </Group>
        {chartPts.length < 2 ? (
          <Text size="sm" c="dimmed">Not enough paired pitches with both values to plot.</Text>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <ScatterChart margin={{ top: 10, right: 20, bottom: 28, left: 6 }}>
              <CartesianGrid stroke={GRID} />
              <XAxis
                type="number"
                dataKey="x"
                domain={["auto", "auto"]}
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
                label={{ value: `${xDef?.label ?? xId}${xDef?.unit ? ` (${xDef.unit})` : ""}`, position: "insideBottom", offset: -14, fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={["auto", "auto"]}
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={48}
                label={{ value: `${yDef?.label ?? yId}${yDef?.unit ? ` (${yDef.unit})` : ""}`, angle: -90, position: "insideLeft", offset: 4, fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
              />
              <RTooltip
                cursor={{ strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.2)" }}
                content={({ payload }) => {
                  const p = payload?.[0]?.payload as { x: number; y: number; r: SyncPitch } | undefined;
                  if (!p || !p.r.tm) return null;
                  return (
                    <div style={TOOLTIP_STYLE}>
                      <div style={{ fontWeight: 600 }}>
                        <PitchDot code={p.r.tm.code} />
                        TM #{p.r.tm.pitchNo ?? "—"} · {PITCH_LABELS[p.r.tm.code]} · {PITCH_CATEGORY_SHORT[p.r.category]} #{p.r.trialIndex}
                      </div>
                      <div>
                        {xDef?.label}: {fmt(p.x, xDef?.digits ?? 1)} {xDef?.unit}
                      </div>
                      <div>
                        {yDef?.label}: {fmt(p.y, yDef?.digits ?? 1)} {yDef?.unit}
                      </div>
                      <div style={{ opacity: 0.7 }}>{fmt(p.r.flight.velo ?? null)} mph</div>
                    </div>
                  );
                }}
              />
              <Scatter data={chartPts} isAnimationActive={false} cursor="pointer" onClick={(e: { payload?: { r: SyncPitch } }) => e?.payload && pick(e.payload.r)}>
                {chartPts.map((p, i) => {
                  const on = trialKey(p.r) === focusKey;
                  return <Cell key={i} fill={PITCH_COLORS[p.r.tm!.code]} stroke={on ? "#f5f8fa" : "rgba(255,255,255,0.35)"} strokeWidth={on ? 3 : 1.5} />;
                })}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
        <Text size="xs" c="dimmed">
          {xDef?.help ? `${xDef.label}: ${xDef.help}. ` : ""}
          {veloOnlyDropped > 0
            ? `${veloOnlyDropped} pitch${veloOnlyDropped === 1 ? "" : "es"} left out: TrackMan only read velo, spin and release on ${veloOnlyDropped === 1 ? "it" : "them"}.`
            : ""}
        </Text>
      </div>
    </Stack>
  );
}
