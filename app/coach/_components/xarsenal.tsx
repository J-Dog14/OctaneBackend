"use client";

/**
 * xArsenal detail for the Pitching tab, following Ryan's handoff (Nov 4 2026, 05 §6-10 and 06):
 * summary + slot line, Arsenal Fit, Arsenal moves, one card per pitch (metric bars, why, levers),
 * grade by outing, and the Add Pitches sandbox. Grades and labels come normalized from
 * lib/pitch-intel/xarsenal/worker.ts; presentation rules from ./normalize.ts.
 */

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Alert, Badge, Button, Checkbox, Group, NumberInput, Paper, ScrollArea, Select, SimpleGrid, Stack, Table, Text, Tooltip } from "@mantine/core";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { PITCH_COLORS, PITCH_LABELS, isPitchCode, type PitchCode } from "@/lib/pitch-intel/pitch-types";
import type { PitchTypeSummary } from "@/lib/pitch-intel/sessions";
import type { ArsenalGrade, ArsenalMove, PitchGrade, XaMetric } from "@/lib/pitch-intel/xarsenal/worker";
import {
  XA_BAND_COLOR,
  stuffPlusColor,
  xaBand,
  xaBarPct,
  xaColor,
  xaGrade,
  xaLabel,
  xaPitchName,
  xaSlotLine,
} from "@/lib/pitch-intel/xarsenal/normalize";
import type { GradedOut, GradeTrend, ScenarioResult } from "@/lib/coach/pitchXa";
import { fmt, swrOpts } from "./fetcher";
import { PitchDot } from "./pitching";

const STUFF_CAPTION = "8ctane model trained on MLB run value · 100 = MLB average · not psStuff+";
const muted = { color: "var(--text-secondary)" } as const;

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function XaSummary({ arsenal, rows }: { arsenal: ArsenalGrade | null; rows: PitchTypeSummary[] }) {
  if (!arsenal) return null;
  const graded = rows.filter((r) => r.grade);
  const slot = xaSlotLine(graded.map((r) => ({ armAngle: r.armAngle ?? null, count: r.count })), arsenal.slot);
  return (
    <div>
      <Group gap="md" align="baseline" wrap="wrap">
        <Text fz={34} fw={800} lh={1} c={xaColor(arsenal.score)}>{arsenal.score}</Text>
        <div>
          <Text fw={700}>xArsenal {arsenal.grade} · {arsenal.label}</Text>
          <Text size="xs" style={muted}>20-80 · graded at {arsenal.compLevel} level</Text>
        </div>
        {arsenal.stuffPlus != null && (
          <Tooltip label={`${STUFF_CAPTION}${arsenal.stuffVersion ? ` · ${arsenal.stuffVersion}` : ""}`}>
            <Badge size="lg" variant="outline" color={stuffPlusColor(arsenal.stuffPlus)}>8-Stuff+ {Math.round(arsenal.stuffPlus)}</Badge>
          </Tooltip>
        )}
      </Group>
      {arsenal.description && <Text size="sm" mt={6}>{arsenal.description}</Text>}
      {slot && <Text size="xs" mt={2} style={muted}>{slot}</Text>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Arsenal Fit
// ---------------------------------------------------------------------------

function ScoreBar({ score, color }: { score: number | null; color?: string }) {
  if (score == null) return <div style={{ flex: 1 }} />;
  return (
    <div style={{ position: "relative", flex: 1, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.08)", minWidth: 60 }}>
      <div style={{ position: "absolute", inset: 0, width: `${xaBarPct(score)}%`, borderRadius: 4, background: color ?? XA_BAND_COLOR[xaBand(score)] }} />
      <div title="50 = MLB average" style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "rgba(255,255,255,0.55)" }} />
    </div>
  );
}

const FIT_COLOR = (s: number | null) => (s == null ? "#8b949e" : s >= 60 ? "#3fb950" : s >= 50 ? "#8b949e" : s >= 40 ? "#d29922" : "#f85149");

export function ArsenalFitCard({ arsenal }: { arsenal: ArsenalGrade | null }) {
  const f = arsenal?.fitDetail;
  if (!arsenal || !f) return null;
  const rows: Array<[string, number | null, string]> = [
    ["Movement coverage", f.parts.coverage, f.strongDirections.length ? `Strong directions: ${f.strongDirections.join(", ")}` : "Strong directions: none at full credit"],
    ["Platoon coverage", f.parts.platoon, [f.bestArmSide != null ? `best arm-side ${Math.round(f.bestArmSide)}` : null, f.bestGloveSide != null ? `best glove-side ${Math.round(f.bestGloveSide)}` : null].filter(Boolean).join(" · ")],
    ["Speed layers", f.parts.speed, [f.speedSpread != null ? `${fmt(f.speedSpread)} mph spread` : null, f.speedEvenness != null ? `${Math.round(f.speedEvenness)}% even` : null].filter(Boolean).join(" · ")],
    ["Redundancy", f.parts.redundancy, f.duplicates.length ? `Same look: ${f.duplicates.join("; ")}` : "No duplicate shapes"],
  ];
  return (
    <div>
      <Text fw={700} size="sm">Arsenal Fit {f.score} <Text span size="xs" style={muted}>· how the pitches work together{arsenal.pitchScore != null ? ` · pitch grades ${Math.round(arsenal.pitchScore)}` : ""}</Text></Text>
      <Text size="xs" style={muted} mb={6}>Arsenal grade = 80% pitch grades + 20% Arsenal Fit, so the arsenal can grade above every single pitch.</Text>
      <Stack gap={6}>
        {rows.map(([name, score, note]) => (
          <div key={name}>
            <Group gap="sm" wrap="nowrap">
              <Text size="xs" w={130} style={{ flexShrink: 0 }}>{name}</Text>
              <ScoreBar score={score} color={FIT_COLOR(score)} />
              <Text size="xs" fw={700} w={28} ta="right">{score == null ? "—" : Math.round(score)}</Text>
            </Group>
            {note && <Text size="xs" style={{ ...muted, marginLeft: 138 }}>{note}</Text>}
          </div>
        ))}
      </Stack>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

const keyName = (k: string | null, fallback: string) => (k && (isPitchCode(k) || /_new\d+$/.test(k)) ? xaPitchName(k) : fallback);

function moveLine(m: ArsenalMove): { head: string; sub: string } {
  const gain = m.gain != null ? `arsenal ${m.gain > 0 ? "+" : ""}${Math.round(m.gain)}` : null;
  if (m.kind === "add") {
    const t = m.target;
    const shape = t ? [t.velo != null ? `~${Math.round(t.velo)} mph` : null, t.ivb != null ? `${Math.round(t.ivb)}" IVB` : null, t.hb != null ? `${Math.abs(Math.round(t.hb))}" ${t.hb >= 0 ? "arm-side" : "glove-side"}` : null].filter(Boolean).join(" · ") : "";
    return {
      head: `${m.title}${shape ? ` · target ${shape}` : ""}`,
      sub: [m.reason, [m.fitGain != null ? `Fit ${m.fitGain > 0 ? "+" : ""}${Math.round(m.fitGain)}` : null, gain].filter(Boolean).join(", "), "(assumes an average version)"].filter(Boolean).join(" · "),
    };
  }
  const name = keyName(m.key, m.title);
  if (m.kind === "rework") return { head: `${name}${m.score != null ? ` (${Math.round(m.score)})` : ""}`, sub: [m.reason, m.focus.length ? `focus: ${m.focus.join(", ")}` : null].filter(Boolean).join(" · ") };
  return { head: `${name}${m.score != null ? ` (${Math.round(m.score)})` : ""}`, sub: [m.reason, gain].filter(Boolean).join(" · ") };
}

export function ArsenalMovesCard({ arsenal, title = "Arsenal moves" }: { arsenal: ArsenalGrade | null; title?: string }) {
  if (!arsenal?.moves.length) return null;
  const color: Record<string, string> = { add: "green", drop: "red", rework: "yellow" };
  return (
    <div>
      <Text fw={700} size="sm" mb={6}>{title} <Text span size="xs" style={muted}>· what would help this arsenal most</Text></Text>
      <Stack gap={6}>
        {arsenal.moves.map((m, i) => {
          const l = moveLine(m);
          return (
            <Group key={i} gap={8} wrap="nowrap" align="flex-start">
              <Badge size="xs" variant="light" color={color[m.kind] ?? "gray"} w={58} style={{ flexShrink: 0 }}>{m.kind}</Badge>
              <div>
                <Text size="sm" fw={600}>{l.head}</Text>
                {l.sub && <Text size="xs" style={muted}>{l.sub}</Text>}
              </div>
            </Group>
          );
        })}
      </Stack>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pitch cards
// ---------------------------------------------------------------------------

const armSide = (hbArm: number) => `${Math.abs(hbArm).toFixed(1)}" ${hbArm >= 0 ? "arm-side" : "glove-side"}`;

/** Ryan's xaValue, with the run gap printed as a magnitude (handoff issue #12). */
function metricValue(m: XaMetric, row: PitchTypeSummary | undefined, g: PitchGrade): string {
  const vs = g.vsFastball ? ` vs ${g.vsFastball}` : "";
  const v = m.value;
  switch (m.key) {
    case "velocity": return row?.velo != null ? `${fmt(row.velo)} mph` : "";
    case "spinRate": return row?.spinRate != null ? `${row.spinRate} rpm` : "";
    case "ivb": return row?.ivb != null ? `${fmt(row.ivb)}"${g.ivbSlotAdj != null ? ` (${fmt(g.ivbSlotAdj)}" slot-adj.)` : ""}` : "";
    case "hb": return row?.hbArm != null ? armSide(row.hbArm) : "";
    case "extension": return row?.extension != null ? `${fmt(row.extension)} ft` : "";
    case "vaa": return row?.vaa != null ? `${fmt(row.vaa)}°` : g.vaaEst != null ? `${fmt(g.vaaEst)}° est.` : "";
    case "spinEfficiency": return g.spinEfficiency != null ? `${g.spinEffEstimated ? "~" : ""}${Math.round(g.spinEfficiency)}%${g.spinEffEstimated ? " est." : ""}` : "";
    case "veloDiff": return v != null ? `${fmt(Math.abs(v))} mph${vs}` : "";
    case "spinDiff": return v != null ? `${Math.round(Math.abs(v))} rpm${vs}` : "";
    case "ivbDiff": return v != null ? `${fmt(Math.abs(v))}"${vs}` : "";
    case "hbDiff": return v != null ? `${fmt(Math.abs(v))}" apart${vs}` : "";
    case "pairVelo": return v != null ? `${fmt(Math.abs(v))} mph apart${vs}` : "";
    case "pairIvb":
    case "pairRun":
    case "pairCut": return v != null ? `${fmt(Math.abs(v))}"${vs}` : "";
    default: return v != null ? fmt(v) : "";
  }
}

const IMP_COLOR: Record<string, string> = { primary: "cyan", secondary: "gray", minor: "dark" };

export function PitchCard({ code, name, grade, row, isNew = false }: { code: string; name?: string; grade: PitchGrade; row?: PitchTypeSummary; isNew?: boolean }) {
  const pc = (isPitchCode(code) ? code : "OTHER") as PitchCode;
  const mix = grade.subtypeMix && Object.keys(grade.subtypeMix).length > 1
    ? Object.entries(grade.subtypeMix).sort((a, b) => b[1] - a[1]).map(([k, w]) => `${Math.round(w)}% ${k}`).join(", ")
    : null;
  const levers = grade.levers.slice(0, 3);
  return (
    <Paper withBorder p="sm" radius="md" style={{ background: "var(--card-bg)", borderLeft: `3px solid ${PITCH_COLORS[pc]}` }}>
      <Group justify="space-between" wrap="nowrap" mb={4}>
        <Group gap={6} wrap="nowrap">
          <PitchDot code={pc} />
          <Text fw={700}>{name ?? PITCH_LABELS[pc]}</Text>
          {isNew && <Badge size="xs" color="cyan" variant="light">new</Badge>}
          {row?.usagePct != null && <Text size="xs" style={muted}>{fmt(row.usagePct)}%</Text>}
        </Group>
        <Group gap={6} wrap="nowrap">
          <Tooltip label={`Score ${grade.score} → grade ${grade.grade}`}>
            <Badge size="lg" variant="light" color={xaColor(grade.score)}>{grade.score} · {grade.label}</Badge>
          </Tooltip>
          {grade.stuffPlus != null && (
            <Tooltip multiline maw={300} label={`8-Stuff+ ${Math.round(grade.stuffPlus)} vs. all MLB pitches${grade.stuffPlusType != null ? ` · ${Math.round(grade.stuffPlusType)} vs. other ${grade.displayType ?? grade.subtype}s` : ""}. ${STUFF_CAPTION}`}>
              <Badge size="lg" variant="outline" color={stuffPlusColor(grade.stuffPlus)}>S+ {Math.round(grade.stuffPlus)}</Badge>
            </Tooltip>
          )}
        </Group>
      </Group>
      <Text size="xs" mb={6}>
        Graded as a <b>{grade.subtype || grade.displayType || "—"}</b>{mix ? <span style={muted}> ({mix})</span> : null}. {grade.why}
      </Text>
      <Stack gap={3}>
        {grade.metrics.map((m) => (
          <Group key={m.key} gap={6} wrap="nowrap">
            <Text size="xs" w={88} style={{ flexShrink: 0 }}>{m.label}</Text>
            <Badge size="xs" variant="light" color={IMP_COLOR[m.importance] ?? "gray"} w={64} style={{ flexShrink: 0 }}>{m.importance}</Badge>
            <Tooltip label={m.direction ? `Helps: ${m.direction}` : m.label} disabled={!m.direction}>
              <Text size="xs" w={150} style={{ ...muted, flexShrink: 0 }} truncate>{metricValue(m, row, grade) || "—"}</Text>
            </Tooltip>
            <ScoreBar score={m.score} />
            <Text size="xs" fw={700} w={22} ta="right">{m.score}</Text>
            <Text size="xs" w={62} style={{ color: XA_BAND_COLOR[xaBand(m.score)], flexShrink: 0 }}>{xaLabel(m.score)}</Text>
          </Group>
        ))}
      </Stack>
      <Text size="xs" mt={6} style={muted}>
        {levers.length
          ? <>Biggest levers: {levers.map((l, i) => <span key={i}>{i ? " · " : ""}<b>+{Math.round(l.points ?? 0)}</b> with {l.text ?? l.metric}{l.metric === "spinEfficiency" && grade.spinEffEstimated ? " (estimated metric)" : ""}</span>)}</>
          : "Every key metric is already grading as good or better."}
      </Text>
    </Paper>
  );
}

export function PitchCards({ rows }: { rows: PitchTypeSummary[] }) {
  const graded = rows.filter((r) => r.grade).sort((a, b) => b.grade!.score - a.grade!.score);
  if (!graded.length) return null;
  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="sm">
      {graded.map((r) => <PitchCard key={r.pitchType} code={r.pitchType} grade={r.grade!} row={r} />)}
    </SimpleGrid>
  );
}

export const XA_FOOTNOTE =
  "Bars show each metric on the 20-80 scale (50 = MLB average, marked). \"Primary\" metrics drive most of the grade. Spin efficiency is only graded when measured (Rapsodo/Hawk-Eye/TrackMan); an estimate is shown but not graded. Off-speed is graded mostly on its gaps from the primary fastball. Levers = points gained if that one metric reached Plus (60).";

// ---------------------------------------------------------------------------
// Grade by outing
// ---------------------------------------------------------------------------

const TOOLTIP_STYLE = { background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.78rem", color: "var(--text-primary)" };
const AXIS_TICK = { fill: "rgba(255,255,255,0.5)", fontSize: 11 };

export function GradeTrendChart({ athleteUuid, season }: { athleteUuid: string; season: number | null }) {
  const key = `/api/coach/athletes/${encodeURIComponent(athleteUuid)}/pitching/trend${season ? `?season=${season}` : ""}`;
  const { data, error, isLoading } = useSWR<GradeTrend>(key, swrOpts);
  const [showArsenal, setShowArsenal] = useState(true);
  const { rows, codes } = useMemo(() => {
    const pts = data?.points ?? [];
    const seen = new Set<string>();
    const rows = pts.map((p) => {
      const r: Record<string, number | string | null> = { date: p.date, label: p.label, arsenal: p.arsenal };
      for (const [k, v] of Object.entries(p.pitches)) {
        r[k] = v;
        seen.add(k);
      }
      return r;
    });
    const order = ["FF", "SI", "FC", "SL", "ST", "CU", "KC", "CH", "FS"];
    return { rows, codes: order.filter((c) => seen.has(c)) };
  }, [data]);
  if (isLoading) return <Text size="sm" style={muted}>Grading each outing…</Text>;
  if (error) return <Text size="sm" c="red">Could not load grades by outing: {error.message}</Text>;
  if (!rows.length) return <Text size="sm" style={muted}>{data?.error ? `Could not load grades: ${data.error}` : "No outing has 5+ pitches of a type to grade."}</Text>;
  return (
    <div>
      <Group justify="flex-end" mb={4}>
        <Checkbox size="xs" label="Arsenal line" checked={showArsenal} onChange={(e) => setShowArsenal(e.currentTarget.checked)} />
      </Group>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={rows} margin={{ top: 8, right: 16, left: -6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
          <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.12)" }} minTickGap={24} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} domain={[(min: number) => Math.min(35, Math.floor(min / 5) * 5), (max: number) => Math.max(70, Math.ceil(max / 5) * 5)]} />
          <ReferenceLine y={50} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" />
          <RTooltip
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(d, p) => `${d}${p?.[0]?.payload?.label ? ` · ${p[0].payload.label}` : ""}`}
            formatter={(v, name) => [String(v), name === "arsenal" ? "Arsenal" : PITCH_LABELS[name as PitchCode] ?? String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === "arsenal" ? "Arsenal" : PITCH_LABELS[v as PitchCode] ?? v)} />
          {codes.map((c) => (
            <Line key={c} type="monotone" dataKey={c} stroke={PITCH_COLORS[c as PitchCode]} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
          ))}
          {showArsenal && <Line type="monotone" dataKey="arsenal" stroke="rgba(255,255,255,0.8)" strokeDasharray="5 4" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
        </LineChart>
      </ResponsiveContainer>
      <Text size="xs" style={muted}>
        Each point = that pitch&apos;s grade in one outing (min 5 pitches) · 20-80 scouting scale: 40 below avg · 50 MLB avg · 60 plus · 70 plus-plus · 80 elite (10 pts = 1 SD)
        {data?.error ? ` · Savant games couldn't be graded (${data.error})` : ""}
      </Text>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Pitches (arsenal sandbox) — Ryan's handoff 06
// ---------------------------------------------------------------------------

const AP_CODES = ["FF", "SI", "FC", "SL", "ST", "CU", "KC", "CH", "FS"] as const;
type ApCode = (typeof AP_CODES)[number];
const AP_MAX = 3;

interface ApAdd { id: number; code: ApCode; velo: number | ""; ivb: number | ""; hbMag: number | ""; hbDir: "arm" | "glove"; spin: number | ""; vaa: number | ""; usage: number | "" }
interface Preset { label: string; velo: number; ivb: number; arm: number }

/** Ryan's apCodeFromMove. */
function codeFromMove(m: ArsenalMove): ApCode | null {
  if (m.key && (AP_CODES as readonly string[]).includes(m.key)) return m.key as ApCode;
  const l = m.title.toLowerCase();
  if (/sweep/.test(l)) return "ST";
  if (/split/.test(l)) return "FS";
  if (/change|kick/.test(l)) return "CH";
  if (/cutter|cut/.test(l)) return "FC";
  if (/sinker|2-seam|two-seam/.test(l)) return "SI";
  if (/4-seam|four-seam|fastball/.test(l)) return "FF";
  if (/knuckle|k-curve/.test(l)) return "KC";
  if (/curve/.test(l)) return "CU";
  if (/slid|slutter|gyro/.test(l)) return "SL";
  return null;
}

type ShapeBaselines = Record<string, { n_total: number; scaler_mean: { velo: number }; clusters: Array<{ n: number; centroid: { velo: number; hb_norm: number; vb: number }; metrics?: { whiff_pct?: number } }> }>;

function useShapeBaselines(): ShapeBaselines | null {
  const { data } = useSWR<ShapeBaselines>("/pitch-intel-app/shape_baselines.json", (u: string) => fetch(u).then((r) => (r.ok ? r.json() : null)), { revalidateOnFocus: false });
  return data ?? null;
}

function presetsFor(code: ApCode, arsenal: ArsenalGrade | null, baselines: ShapeBaselines | null, fbVelo: number | null): Preset[] {
  const out: Preset[] = [];
  for (const m of arsenal?.moves ?? []) {
    if (m.kind !== "add" || codeFromMove(m) !== code || !m.target || m.target.velo == null || m.target.ivb == null || m.target.hb == null) continue;
    out.push({ label: `Worker suggestion · ${m.title}`, velo: m.target.velo, ivb: m.target.ivb, arm: m.target.hb });
  }
  const b = baselines?.[code];
  if (b) {
    const ffMean = baselines?.FF?.scaler_mean?.velo ?? 94.5;
    b.clusters
      .filter((c) => c.n >= 0.05 * b.n_total)
      .sort((x, y) => y.n - x.n)
      .forEach((c, i) => {
        const ivb = Math.round(c.centroid.vb * 12 * 10) / 10;
        const arm = Math.round(-c.centroid.hb_norm * 12 * 10) / 10;
        const dv = c.centroid.velo - ffMean;
        const velo = Math.round((fbVelo != null ? fbVelo + dv : c.centroid.velo) * 10) / 10;
        out.push({
          label: `Common MLB shape ${i + 1} · ${Math.round(ivb)}" IVB · ${Math.abs(Math.round(arm))}" ${arm >= 0 ? "arm" : "glove"}-side · ${dv >= 0 ? "+" : ""}${Math.round(dv)} mph vs FB${c.metrics?.whiff_pct != null ? ` · ${Math.round(c.metrics.whiff_pct)}% whiff in MLB` : ""}`,
          velo, ivb, arm,
        });
      });
  }
  return out;
}

function fromPreset(id: number, code: ApCode, p: Preset | undefined, usage: number | "" = 12): ApAdd {
  return { id, code, velo: p?.velo ?? "", ivb: p?.ivb ?? "", hbMag: p ? Math.abs(p.arm) : "", hbDir: !p || p.arm >= 0 ? "arm" : "glove", spin: "", vaa: "", usage };
}

const delta = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : Math.round(b - a));
function Delta({ d }: { d: number | null }) {
  if (d == null) return <>—</>;
  return <Text span fw={700} c={d > 0 ? "green" : d < 0 ? "red" : "dimmed"}>{d > 0 ? `+${d}` : d}</Text>;
}

export function AddPitchesView({ athleteUuid, snapshotKey, label, rows, arsenal, throws }: {
  athleteUuid: string;
  snapshotKey: string;
  label: string;
  rows: PitchTypeSummary[];
  arsenal: ArsenalGrade | null;
  throws: "L" | "R" | null;
}) {
  const baselines = useShapeBaselines();
  const current = rows.filter((r) => r.grade);
  const fbVelo = useMemo(() => {
    const fb = rows.filter((r) => (r.pitchType === "FF" || r.pitchType === "SI") && r.velo != null).sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0];
    return fb?.velo ?? (rows.length ? Math.max(...rows.map((r) => r.velo ?? 0)) || null : null);
  }, [rows]);

  const [seq, setSeq] = useState(1);
  const [adds, setAdds] = useState<ApAdd[]>([]);
  const [drop, setDrop] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // First load (and athlete / snapshot change): one row seeded from the Worker's first suggested add.
  useEffect(() => {
    const first = arsenal?.moves.find((m) => m.kind === "add");
    const code = (first && codeFromMove(first)) || AP_CODES.find((c) => !rows.some((r) => r.pitchType === c)) || "CH";
    setAdds([fromPreset(1, code, presetsFor(code, arsenal, baselines, fbVelo)[0])]);
    setSeq(2);
    setDrop(new Set());
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteUuid, snapshotKey, baselines != null]);

  const edit = (id: number, patch: Partial<ApAdd>) => { setAdds((xs) => xs.map((a) => (a.id === id ? { ...a, ...patch } : a))); setStale(true); };

  async function grade() {
    setErr(null);
    const valid = adds.filter((a) => a.velo !== "" && a.ivb !== "" && a.hbMag !== "");
    const body = {
      snapshot: snapshotKey,
      drop: [...drop],
      adds: valid.map((a) => ({
        code: a.code, velo: Number(a.velo), ivb: Number(a.ivb), arm: Number(a.hbMag) * (a.hbDir === "arm" ? 1 : -1),
        spin: a.spin === "" ? null : Number(a.spin), vaa: a.vaa === "" ? null : Number(a.vaa), usage: a.usage === "" ? 12 : Number(a.usage),
      })),
    };
    setBusy(true);
    try {
      const res = await fetch(`/api/coach/athletes/${encodeURIComponent(athleteUuid)}/pitching/scenario`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`);
      setResult(json as ScenarioResult);
      setStale(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!current.length) return <Text c="dimmed">This arsenal has no graded pitches to build on. Pick a season or session with grades.</Text>;

  return (
    <Stack gap="md">
      <div className="card" style={{ marginBottom: 0 }}>
        <Text fw={700}>Add Pitches · {label}</Text>
        <Text size="xs" style={muted} mb="sm">
          Test a pitch he doesn&apos;t throw yet (or drop one he does) and see how xArsenal, Arsenal Fit and every pitch grade move. New pitches are released from his current slot{throws === "L" ? " (LHP)" : ""}. Nothing is saved.
        </Text>
        <Text size="xs" fw={600} mb={4}>Current pitches (uncheck to test dropping)</Text>
        <Group gap="xs" mb="md">
          {current.map((r) => (
            <Checkbox key={r.pitchType} size="xs" checked={!drop.has(r.pitchType)}
              label={`${r.label} · ${r.grade!.score}`}
              onChange={(e) => { const on = e.currentTarget.checked; setDrop((s) => { const n = new Set(s); if (on) n.delete(r.pitchType); else n.add(r.pitchType); return n; }); setStale(true); }} />
          ))}
        </Group>
        <Stack gap="sm">
          {adds.map((a) => {
            const presets = presetsFor(a.code, arsenal, baselines, fbVelo);
            const bad = a.velo === "" || a.ivb === "" || a.hbMag === "" ? "Needs velo, IVB and HB to grade." : Number(a.velo) < 50 || Number(a.velo) > 105 ? "Velo should be between 50 and 105 mph." : null;
            return (
              <Paper key={a.id} withBorder p="sm" radius="md" style={{ background: "var(--card-bg)" }}>
                <Group gap="xs" align="flex-end" wrap="wrap">
                  <Select label="Pitch type" w={150} allowDeselect={false} value={a.code}
                    data={AP_CODES.map((c) => ({ value: c, label: `New ${PITCH_LABELS[c]}` }))}
                    onChange={(v) => { if (!v) return; const code = v as ApCode; const p = presetsFor(code, arsenal, baselines, fbVelo)[0]; setAdds((xs) => xs.map((x) => (x.id === a.id ? fromPreset(a.id, code, p, a.usage) : x))); setStale(true); }} />
                  <Select label="Start from a shape…" w={360} placeholder={presets.length ? "Pick a preset" : "No presets for this type"} data={presets.map((p, i) => ({ value: String(i), label: p.label }))} value={null}
                    onChange={(v) => { const p = v == null ? undefined : presets[Number(v)]; if (p) edit(a.id, { velo: p.velo, ivb: p.ivb, hbMag: Math.abs(p.arm), hbDir: p.arm >= 0 ? "arm" : "glove" }); }} />
                  <NumberInput label="Velo (mph)" w={96} value={a.velo} decimalScale={1} onChange={(v) => edit(a.id, { velo: v === "" ? "" : Number(v) })} />
                  <NumberInput label='IVB (")' w={86} value={a.ivb} decimalScale={1} onChange={(v) => edit(a.id, { ivb: v === "" ? "" : Number(v) })} />
                  <NumberInput label='HB (")' w={80} min={0} value={a.hbMag} decimalScale={1} onChange={(v) => edit(a.id, { hbMag: v === "" ? "" : Math.abs(Number(v)) })} />
                  <Select label="Direction" w={112} allowDeselect={false} value={a.hbDir} data={[{ value: "arm", label: "arm-side" }, { value: "glove", label: "glove-side" }]} onChange={(v) => edit(a.id, { hbDir: (v as "arm" | "glove") ?? "arm" })} />
                  <NumberInput label="Spin (opt.)" w={92} value={a.spin} onChange={(v) => edit(a.id, { spin: v === "" ? "" : Number(v) })} />
                  <NumberInput label="VAA (opt.)" w={86} value={a.vaa} decimalScale={1} onChange={(v) => edit(a.id, { vaa: v === "" ? "" : Number(v) })} />
                  <NumberInput label="Usage %" w={80} min={1} max={90} value={a.usage} onChange={(v) => edit(a.id, { usage: v === "" ? "" : Number(v) })} />
                  <Button variant="subtle" color="red" size="compact-sm" onClick={() => { setAdds((xs) => xs.filter((x) => x.id !== a.id)); setStale(true); }}>Remove</Button>
                </Group>
                {bad && <Text size="xs" c="yellow" mt={4}>{bad}</Text>}
              </Paper>
            );
          })}
        </Stack>
        <Group mt="sm" gap="sm">
          <Button size="compact-sm" variant="light" disabled={adds.length >= AP_MAX}
            onClick={() => { const code = AP_CODES.find((c) => !rows.some((r) => r.pitchType === c) && !adds.some((x) => x.code === c)) ?? "CH"; setAdds((xs) => [...xs, fromPreset(seq, code, presetsFor(code, arsenal, baselines, fbVelo)[0])]); setSeq(seq + 1); setStale(true); }}>
            + Another pitch
          </Button>
          <Button size="compact-sm" onClick={grade} loading={busy}>Grade with these changes</Button>
          {stale && result && <Text size="xs" c="yellow">Changes not graded yet — press Grade with these changes.</Text>}
        </Group>
        {err && <Alert color="yellow" mt="sm">{err}</Alert>}
      </div>
      {result && <ScenarioResults result={result} stale={stale} />}
    </Stack>
  );
}

function ScenarioResults({ result, stale }: { result: ScenarioResult; stale: boolean }) {
  const now = result.now.arsenal;
  const nxt = result.scenario.arsenal;
  const f0 = now?.fitDetail;
  const f1 = nxt?.fitDetail;
  const moved: Array<[string, number | null | undefined, number | null | undefined]> = [
    ["xArsenal", now?.score, nxt?.score],
    ["Pitch grades (80%)", now?.pitchScore, nxt?.pitchScore],
    ["Arsenal Fit (20%)", now?.fit, nxt?.fit],
    ["Movement coverage", f0?.parts.coverage, f1?.parts.coverage],
    ["Platoon coverage", f0?.parts.platoon, f1?.parts.platoon],
    ["Speed layers", f0?.parts.speed, f1?.parts.speed],
    ["Redundancy", f0?.parts.redundancy, f1?.parts.redundancy],
    ["8-Stuff+ (arsenal)", now?.stuffPlus, nxt?.stuffPlus],
  ];
  const keys = [...new Set([...Object.keys(result.now.pitches), ...Object.keys(result.scenario.pitches), ...result.addedKeys])];
  const byScore = (g: GradedOut, k: string) => g.pitches[k]?.score ?? null;
  keys.sort((a, b) => (byScore(result.scenario, b) ?? -1) - (byScore(result.scenario, a) ?? -1));
  const d = delta(now?.score, nxt?.score);
  const r = (v: number | null | undefined) => (v == null ? "—" : String(Math.round(v)));
  return (
    <Stack gap="md" style={{ opacity: stale ? 0.55 : 1 }}>
      <div className="card" style={{ marginBottom: 0 }}>
        <Group gap="xl" align="center">
          <div><Text size="xs" style={muted}>Now</Text><Text fz={28} fw={800}>{now?.score ?? "—"}</Text><Text size="xs">{now ? `${now.grade} · ${now.label}` : ""}</Text></div>
          <Text fz={22} fw={800} c={d == null ? "dimmed" : d > 0 ? "green" : d < 0 ? "red" : "dimmed"}>{d == null ? "→" : d > 0 ? `+${d} →` : `${d} →`}</Text>
          <div><Text size="xs" style={muted}>With changes</Text><Text fz={28} fw={800} c={xaColor(nxt?.score)}>{nxt?.score ?? "—"}</Text><Text size="xs">{nxt ? `${xaGrade(nxt.score)} · ${nxt.label}` : ""}</Text></div>
        </Group>
        {result.ungraded.length > 0 && <Alert color="yellow" mt="sm">The Worker didn&apos;t grade: {result.ungraded.map(xaPitchName).join(", ")}. Check the shape.</Alert>}
        <SimpleGrid cols={{ base: 1, md: 2 }} mt="md" spacing="lg">
          <ScrollArea>
            <Text fw={700} size="sm" mb={4}>What moved</Text>
            <Table fz="sm" verticalSpacing={3}>
              <Table.Thead><Table.Tr><Table.Th /><Table.Th ta="right">Now</Table.Th><Table.Th ta="right">With changes</Table.Th><Table.Th ta="right">Change</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {moved.map(([name, a, b]) => (
                  <Table.Tr key={name}><Table.Td>{name}</Table.Td><Table.Td ta="right">{r(a)}</Table.Td><Table.Td ta="right">{r(b)}</Table.Td><Table.Td ta="right"><Delta d={delta(a, b)} /></Table.Td></Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          <ScrollArea>
            <Text fw={700} size="sm" mb={4}>Pitch by pitch</Text>
            <Table fz="sm" verticalSpacing={3}>
              <Table.Thead><Table.Tr><Table.Th>Pitch</Table.Th><Table.Th ta="right">Now</Table.Th><Table.Th ta="right">With changes</Table.Th><Table.Th ta="right">Change</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {keys.map((k) => {
                  const a = result.now.pitches[k];
                  const b = result.scenario.pitches[k];
                  const dropped = result.dropped.includes(k);
                  const isNew = result.addedKeys.includes(k);
                  return (
                    <Table.Tr key={k} style={dropped ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
                      <Table.Td>{xaPitchName(k)}{isNew && <Badge size="xs" ml={6} color="cyan" variant="light">new</Badge>}</Table.Td>
                      <Table.Td ta="right">{a ? `${a.score} ${a.label}` : "—"}</Table.Td>
                      <Table.Td ta="right">{dropped ? "dropped" : b ? `${b.score} ${b.label}` : "—"}</Table.Td>
                      <Table.Td ta="right">{dropped ? "—" : <Delta d={delta(a?.score, b?.score)} />}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </SimpleGrid>
      </div>
      {result.addedKeys.some((k) => result.scenario.pitches[k]) && (
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="sm">
          {result.addedKeys.filter((k) => result.scenario.pitches[k]).map((k) => (
            <PitchCard key={k} code={k.split("_")[0]!} name={`New ${PITCH_LABELS[(isPitchCode(k.split("_")[0]) ? k.split("_")[0] : "OTHER") as PitchCode]}`} grade={result.scenario.pitches[k]!} isNew />
          ))}
        </SimpleGrid>
      )}
      {nxt && <div className="card" style={{ marginBottom: 0 }}><ArsenalMovesCard arsenal={nxt} title="Next moves with these changes" /></div>}
      <Text size="xs" style={muted}>
        Grades the shape you enter at the athlete&apos;s level against the same private benchmarks as the Arsenal view. It can&apos;t tell you whether he can throw the pitch, command it, or keep his other pitches intact while learning it. Off-speed is graded on its gaps from the primary fastball, so adding or dropping a fastball can move the off-speed grades too. Spin and VAA are optional; leave them blank and the Worker works without them (VAA is estimated).
      </Text>
    </Stack>
  );
}
