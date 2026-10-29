"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Alert, Badge, Button, Group, Loader, Paper, ScrollArea, SegmentedControl, Select, Stack, Table, Text } from "@mantine/core";
import type { ArsenalSnapshot, CoachPitching } from "@/lib/coach/pitching";
import { fmt, fmtDate, pitchingKey, swrOpts } from "../_components/fetcher";
import { ArsenalBadge, ArsenalMoves, MovementPlot, PitchTypeTable, WHIFF_MIN_SWINGS } from "../_components/pitching";
import { PitchReport } from "../_components/pitchReport";
import { MetricTrends } from "../_components/metricTrends";
import { SectionHead } from "./shared";

type View = "report" | "arsenal" | "games" | "sessions" | "trends" | "dashboard";

const REPORT_SOURCE: Record<string, string> = {
  trackman_summary: "Trackman summary",
  savant: "Savant / scouting",
  claw: "CLAW",
  rapsodo: "Rapsodo",
  other: "Report",
};

/** Every graded or gradable snapshot, newest first, for the arsenal picker. */
function snapshots(d: CoachPitching): Array<ArsenalSnapshot & { key: string }> {
  const out: Array<ArsenalSnapshot & { key: string }> = [];
  for (const s of d.seasons) out.push({ key: `season:${s.season}`, source: "savant", date: s.lastDate, label: `${s.season} season · Savant (${s.games} G, ${s.pitches} P)`, byType: s.byType, arsenal: s.arsenal });
  for (const s of d.sessions) out.push({ key: `tm:${s.date}:${s.sessionType}`, source: "trackman", date: s.date, label: `${s.date} · Trackman ${s.sessionType} (${s.pitches} P)`, byType: s.byType, arsenal: s.arsenal });
  for (const r of d.reports) {
    const date = r.date ?? r.createdAt.slice(0, 10);
    out.push({ key: `rep:${r.id}`, source: "report", date, label: `${date} · ${REPORT_SOURCE[r.source] ?? r.source}${r.title ? ` · ${r.title}` : ""}`, byType: r.byType, arsenal: r.arsenal });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

function ArsenalView({ d }: { d: CoachPitching }) {
  const all = useMemo(() => snapshots(d), [d]);
  const [key, setKey] = useState<string | null>(all[0]?.key ?? null);
  const [compareKey, setCompareKey] = useState<string | null>(null);
  const cur = all.find((s) => s.key === key) ?? all[0];
  const cmp = all.find((s) => s.key === compareKey);
  if (!cur) return <Text c="dimmed">No pitch data yet.</Text>;
  const options = all.map((s) => ({ value: s.key, label: s.label }));
  return (
    <Stack gap="md">
      {d.xaError && <Alert color="yellow">xArsenal / 8-Stuff+ grades are unavailable right now ({d.xaError}). Pitch data below is unaffected.</Alert>}
      <Group gap="sm" align="flex-end">
        <Select label="Showing" data={options} value={cur.key} onChange={setKey} w={380} allowDeselect={false} />
        <Select label="Compare with" data={options.filter((o) => o.value !== cur.key)} value={compareKey} onChange={setCompareKey} w={380} clearable placeholder="Optional" />
      </Group>
      <div className="card" style={{ marginBottom: 0 }}>
        <Group justify="space-between" mb="xs">
          <SectionHead title="Pitch movement" sub={cmp ? "● current · ◆ comparison" : "dot size = usage"} />
          <Group gap="xs">
            <ArsenalBadge arsenal={cur.arsenal} size="md" />
            {cmp && <ArsenalBadge arsenal={cmp.arsenal} size="md" />}
          </Group>
        </Group>
        <MovementPlot sets={cmp ? [{ name: cur.label, rows: cur.byType, throws: d.athlete.throws }, { name: cmp.label, rows: cmp.byType, throws: d.athlete.throws }] : [{ name: cur.label, rows: cur.byType, throws: d.athlete.throws }]} />
        <ArsenalMoves arsenal={cur.arsenal} />
      </div>
      <div className="card" style={{ marginBottom: 0 }}>
        <SectionHead title={cur.label} sub="HB arm-side positive · IVB and HB in inches" />
        <PitchTypeTable rows={cur.byType} />
        {cmp && (
          <>
            <div style={{ height: 16 }} />
            <SectionHead title={cmp.label} />
            <PitchTypeTable rows={cmp.byType} />
          </>
        )}
        <Text size="xs" c="dimmed" mt="xs">
          xArsenal v3 (20-80, 50 = MLB average for that shape) and 8-Stuff+ (100 = average MLB pitch), graded by the 8ctane API; 5+ pitches of a type per session (10+ per Savant season). Whiff% marked * rests on fewer than {WHIFF_MIN_SWINGS} swings.
        </Text>
      </div>
    </Stack>
  );
}

function GamesView({ d }: { d: CoachPitching }) {
  if (!d.games.length) return <Text c="dimmed">No Savant games. Trackman games are under Sessions.</Text>;
  return (
    <div className="card">
      <SectionHead title="Savant games" sub={`last ${d.games.length}`} />
      <ScrollArea>
        <Table fz="sm" verticalSpacing={4} miw={760} highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th>
              <Table.Th>Opp</Table.Th>
              <Table.Th ta="right">Pitches</Table.Th>
              <Table.Th ta="right">K</Table.Th>
              <Table.Th ta="right">BB</Table.Th>
              <Table.Th ta="right">Strike%</Table.Th>
              <Table.Th ta="right">CSW%</Table.Th>
              <Table.Th ta="right">Whiff%</Table.Th>
              <Table.Th ta="right">FB velo</Table.Th>
              <Table.Th ta="right">FB max</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {d.games.map((g) => (
              <Table.Tr key={g.gamePk}>
                <Table.Td>{fmtDate(g.date)}</Table.Td>
                <Table.Td>{g.opponent ?? "—"}</Table.Td>
                <Table.Td ta="right">{g.pitches}</Table.Td>
                <Table.Td ta="right">{g.strikeouts}</Table.Td>
                <Table.Td ta="right">{g.walks}</Table.Td>
                <Table.Td ta="right">{fmt(g.strikePct)}</Table.Td>
                <Table.Td ta="right">{fmt(g.cswPct)}</Table.Td>
                <Table.Td ta="right">{fmt(g.whiffPct)}</Table.Td>
                <Table.Td ta="right" fw={600}>{fmt(g.fbVelo)}</Table.Td>
                <Table.Td ta="right">{fmt(g.fbVeloMax)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <Text size="xs" c="dimmed" mt="xs">Strike% includes fouls and balls in play. CSW% = called + swinging strikes ÷ pitches. Whiff% is per swing. FB = 4-seam + sinker.</Text>
    </div>
  );
}

function SessionsView({ d }: { d: CoachPitching }) {
  const [filter, setFilter] = useState("all");
  const sessions = d.sessions.filter((s) => filter === "all" || s.sessionType === filter);
  const reports = filter === "all" || filter === "reports" ? d.reports : [];
  const shownSessions = filter === "reports" ? [] : sessions;
  return (
    <Stack gap="md">
      <SegmentedControl
        w="fit-content"
        value={filter}
        onChange={setFilter}
        data={[
          { value: "all", label: "All" },
          { value: "game", label: `Games (${d.sessions.filter((s) => s.sessionType === "game").length})` },
          { value: "bullpen", label: `Bullpens (${d.sessions.filter((s) => s.sessionType === "bullpen").length})` },
          { value: "reports", label: `Reports (${d.reports.length})` },
        ]}
      />
      {!shownSessions.length && !reports.length && <Text c="dimmed">Nothing here yet.</Text>}
      {shownSessions.map((s) => (
        <Paper key={`${s.date}|${s.sessionType}`} withBorder p="md" radius="md" style={{ background: "var(--card-bg)" }}>
          <Group justify="space-between" mb="xs">
            <Group gap="sm">
              <Text fw={700}>{fmtDate(s.date)}</Text>
              <Badge color={s.sessionType === "game" ? "blue" : "grape"} variant="light">{s.sessionType === "game" ? "Game" : "Bullpen"}</Badge>
              <Text size="sm" c="dimmed">{s.pitches} pitches · Trackman</Text>
            </Group>
            <ArsenalBadge arsenal={s.arsenal} />
          </Group>
          <PitchTypeTable rows={s.byType} />
        </Paper>
      ))}
      {reports.map((r) => (
        <Paper key={`r${r.id}`} withBorder p="md" radius="md" style={{ background: "var(--card-bg)" }}>
          <Group justify="space-between" mb="xs">
            <Group gap="sm">
              <Text fw={700}>{r.date ? fmtDate(r.date) : r.season ?? fmtDate(r.createdAt.slice(0, 10))}</Text>
              <Badge color="cyan" variant="light">{REPORT_SOURCE[r.source] ?? r.source}</Badge>
              {r.title && <Text size="sm">{r.title}</Text>}
              {r.level && <Text size="sm" c="dimmed">{r.level}</Text>}
            </Group>
            <ArsenalBadge arsenal={r.arsenal} />
          </Group>
          <PitchTypeTable rows={r.byType} />
          {r.notes && <Text size="sm" c="dimmed" mt="xs">{r.notes}</Text>}
        </Paper>
      ))}
    </Stack>
  );
}

/** Ryan's Pitch Intelligence app, embedded as-is. It reads Baseball Savant only. */
function DashboardView({ athleteUuid }: { athleteUuid: string }) {
  const src = `/pitch-intel-app/athletes.html?athlete=${encodeURIComponent(athleteUuid)}`;
  return (
    <div>
      <Group justify="space-between" mb={6}>
        <Text size="sm" c="dimmed">
          Ryan&apos;s Pitch Intelligence dashboard · <b>Baseball Savant games only</b> (pitch-by-pitch, locations, situational, AI insights).
          Trackman bullpens and games are in Pitch report.
        </Text>
        <Button component="a" href={src} target="_blank" rel="noreferrer" size="compact-sm" variant="subtle">Open full screen</Button>
      </Group>
      <iframe
        key={src}
        src={src}
        title="Pitch Intelligence dashboard (Savant)"
        style={{ width: "100%", height: "calc(100vh - 260px)", minHeight: 640, border: 0, borderRadius: 8, background: "#0b0d12" }}
      />
    </div>
  );
}

export function PitchingTab({ athleteUuid }: { athleteUuid: string }) {
  const { data, error, isLoading } = useSWR<CoachPitching>(pitchingKey(athleteUuid), swrOpts);
  const [view, setView] = useState<View>("report");
  if (isLoading) return <Loader size="sm" />;
  if (error) return <Alert color="red">{error.message}</Alert>;
  if (!data) return null;

  const hasPitchByPitch = data.athlete.hasSavant || data.sessions.length > 0;
  const views = [
    ...(hasPitchByPitch ? [{ value: "report", label: "Pitch report" }] : []),
    { value: "arsenal", label: "Arsenal" },
    ...(data.games.length ? [{ value: "games", label: `Games (${data.games.length})` }] : []),
    ...(data.sessions.length || data.reports.length ? [{ value: "sessions", label: "Trackman & reports" }] : []),
    ...(hasPitchByPitch ? [{ value: "trends", label: "Trends" }] : []),
    ...(data.athlete.hasSavant ? [{ value: "dashboard", label: "Savant dashboard" }] : []),
  ];
  const active = views.some((v) => v.value === view) ? view : (views[0]!.value as View);

  const setupNote = data.uploadTablesMissing ? (
    <Alert color="yellow" variant="light" title="Trackman and report tables aren't set up on this database">
      Savant data is shown below. Run <code>npm run pi:setup</code> once from the repo root to add the Trackman and screenshot-report tables, then reload.
    </Alert>
  ) : null;

  if (!data.hasAnyData) {
    if (setupNote) return setupNote;
    return (
      <Alert color="gray" title="No pitch data yet">
        Once this athlete is linked to Baseball Savant or has Trackman files uploaded, games, bullpens and arsenal grades show up here.
      </Alert>
    );
  }

  return (
    <Stack gap="md">
      {setupNote}
      <Group justify="space-between">
        <SegmentedControl value={active} onChange={(v) => setView(v as View)} data={views} />
        <Text size="sm" c="dimmed">
          {data.athlete.throws ? `${data.athlete.throws}HP` : "Throws unknown"} · graded vs {data.athlete.level ?? "default level"}
        </Text>
      </Group>
      {active === "arsenal" && <ArsenalView d={data} />}
      {active === "games" && <GamesView d={data} />}
      {active === "sessions" && <SessionsView d={data} />}
      {active === "report" && <PitchReport athleteUuid={athleteUuid} />}
      {active === "trends" && <MetricTrends athleteUuid={athleteUuid} />}
      {active === "dashboard" && <DashboardView athleteUuid={athleteUuid} />}
    </Stack>
  );
}
