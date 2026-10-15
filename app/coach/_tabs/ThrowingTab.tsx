"use client";

/**
 * Program Throwing tab: one week across the screen (Sunday → Saturday), each
 * day listing its plyos (drill, reps, ball weight) and its throwing activity,
 * with a volume / intensity line drawn under the day headers so heavy, high-intent
 * days stand out from off days and light plyo days.
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import { ActionIcon, Alert, Badge, Button, Group, Loader, Select, Stack, Text, Tooltip } from "@mantine/core";
import type { ThrowingDay, ThrowingHistory } from "@/lib/coach/programThrowing";
import { fmtDate, swrOpts } from "../_components/fetcher";
import { dayNum, dayStr } from "../_components/programHeat";
import { SyncDatabaseButton } from "../_components/SyncDatabaseButton";
import { DoneMark, SeriesKey, WeekGrid, WeekLineChart, localToday, weekDates, weekStart } from "../_components/WeekStrip";
import { StatTile } from "./shared";

export const throwingKey = (uuid: string) => `/api/coach/athletes/${encodeURIComponent(uuid)}/program-throwing`;

const INTENSITY_COLOR = "#f05252";
const VOLUME_COLOR = "#4a90e2";

function repsText(reps: number[]): string {
  if (!reps.length) return "";
  return reps.every((r) => r === reps[0]) ? `${reps.length}×${reps[0]}` : reps.join(", ");
}

function DayCell({ date, day, today }: { date: string; day: ThrowingDay | null; today: string }) {
  const isToday = date === today;
  return (
    <div style={{
      background: "var(--bg-inset)", border: isToday ? "1px solid var(--accent)" : "1px solid var(--border-soft)", borderRadius: 8,
      padding: "8px 9px", minHeight: 140, fontSize: "0.8rem", display: "flex", flexDirection: "column", gap: 8, minWidth: 0,
    }}>
      {!day && <Text size="xs" c="dimmed">Off</Text>}
      {day?.plyo && (
        <div>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4} style={{ lineHeight: 1.3 }}>
            {day.plyo.name}{day.plyo.intensity != null ? <span style={{ fontWeight: 500, textTransform: "none" }}> · level {day.plyo.intensity}</span> : null}
          </Text>
          {day.plyo.drills.length === 0 && <Text size="xs" c="dimmed">No drills listed</Text>}
          {day.plyo.drills.map((dr, i) => (
            <div key={`${dr.name}-${i}`} style={{ display: "flex", flexWrap: "wrap", columnGap: 6, justifyContent: "space-between", alignItems: "baseline", marginBottom: 3, lineHeight: 1.3 }}>
              <span style={{ minWidth: 0 }}>
                <DoneMark done={dr.completed} sets={dr.reps.length} />
                {dr.name}
              </span>
              <span style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{repsText(dr.reps)}{dr.ball ? ` · ${dr.ball}` : ""}</span>
            </div>
          ))}
        </div>
      )}
      {day?.throwing && (
        <div style={{ borderTop: day.plyo ? "1px solid var(--border-soft)" : undefined, paddingTop: day.plyo ? 6 : 0 }}>
          <Text size="sm" fw={700} style={{ lineHeight: 1.25 }}>{day.throwing.name}</Text>
          <Group gap={4} mt={4}>
            {day.throwing.count != null && <Badge size="xs" variant="light" color="blue">{day.throwing.count} throws</Badge>}
            {day.throwing.intent === "HIGH" && <Badge size="xs" variant="light" color="red">High intent</Badge>}
            {day.throwing.intent === "NOT_HIGH" && <Badge size="xs" variant="light" color="gray">Low intent</Badge>}
          </Group>
          {day.throwing.description && (
            <Text size="xs" c="dimmed" mt={4} lineClamp={4} title={day.throwing.description}>{day.throwing.description}</Text>
          )}
        </div>
      )}
    </div>
  );
}

export function ThrowingTab({ athleteUuid }: { athleteUuid: string }) {
  const { data, error, isLoading } = useSWR<ThrowingHistory>(throwingKey(athleteUuid), swrOpts);
  const today = localToday();
  const [programPick, setProgramPick] = useState<string | null>(null);
  const [weekPick, setWeekPick] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const programs = data?.programs.filter((p) => p.days > 0) ?? [];
  const current = programs.find((p) => p.start <= today && (!p.end || p.end >= today)) ?? programs[0];
  const programId = programPick ?? (current ? String(current.id) : "all");
  const days = useMemo(() => (data?.days ?? []).filter((d) => programId === "all" || String(d.programId) === programId), [data, programId]);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  if (isLoading) return <Loader size="sm" />;
  if (error) return <Alert color="red">{error.message}</Alert>;
  if (!data) return null;
  if (!data.linked) return <Text c="dimmed">No 8ctane app account is matched to this athlete (check the email on the athlete profile).</Text>;
  if (!days.length && !programs.length) return <Text c="dimmed">No plyos or throwing in this athlete&apos;s 8ctane app programs yet.</Text>;

  const dates = days.map((d) => d.date).sort();
  const first = dates[0] ?? today;
  const last = dates.at(-1) ?? today;
  const defaultWeek = weekStart(today >= first && today <= last ? today : today > last ? last : first);
  const week = weekPick ?? defaultWeek;
  const weekDays = weekDates(week).map((date) => ({ date, day: byDate.get(date) ?? null }));
  const maxVolume = Math.max(1, ...days.map((d) => d.volume));
  const weekThrows = weekDays.reduce((a, d) => a + (d.day?.volume ?? 0), 0);
  const highDays = weekDays.filter((d) => (d.day?.intensity ?? 0) >= 80).length;
  const offDays = weekDays.filter((d) => !d.day).length;
  const loggedPlyo = weekDays.flatMap((d) => d.day?.plyo?.drills ?? []);
  const plyoDone = loggedPlyo.reduce((a, dr) => a + (dr.completed ?? 0), 0);
  const plyoSets = weekDays.filter((d) => d.date <= today).flatMap((d) => d.day?.plyo?.drills ?? []).reduce((a, dr) => a + dr.reps.length, 0);
  const uncounted = weekDays.filter((d) => d.day?.throwing && d.day.throwing.count == null).length;
  const snapshotDays = data.snapshotAt ? Math.floor(dayNum(today) - dayNum(data.snapshotAt.slice(0, 10))) : null;

  const chart = (
    <WeekLineChart
      yMax={100} topLabel="high" bottomLabel="low / off" hover={hover} setHover={setHover}
      series={[
        { key: "volume", label: "Volume", color: VOLUME_COLOR, values: weekDays.map((d) => (d.day ? (d.day.volume / maxVolume) * 100 : 0)) },
        { key: "intensity", label: "Intensity", color: INTENSITY_COLOR, values: weekDays.map((d) => d.day?.intensity ?? 0) },
      ]}
      tooltip={(i) => {
        const d = weekDays[i]!;
        return (
          <>
            <div style={{ fontWeight: 600 }}>{fmtDate(d.date)}</div>
            {d.day ? (
              <>
                <div><span style={{ color: INTENSITY_COLOR }}>●</span> Intensity {d.day.intensity} · {d.day.intensityLabel}</div>
                <div><span style={{ color: VOLUME_COLOR }}>●</span> Volume {d.day.volume} throws{d.day.throwing && d.day.throwing.count == null ? " + throwing (count not set)" : ""}</div>
              </>
            ) : <div style={{ color: "var(--text-secondary)" }}>Off</div>}
          </>
        );
      }}
    />
  );

  return (
    <Stack gap="md">
      <Group gap="sm" wrap="wrap">
        <Select size="sm" w={320} value={programId} onChange={(v) => { setProgramPick(v); setWeekPick(null); }} allowDeselect={false}
          data={[
            ...programs.map((p) => ({ value: String(p.id), label: `${p.name} · ${fmtDate(p.start)}${p.end ? ` – ${fmtDate(p.end)}` : ""}${p.archived ? " (archived)" : ""}` })),
            { value: "all", label: "All programs" },
          ]} />
        <Group gap={4}>
          <ActionIcon variant="default" onClick={() => setWeekPick(week - 7)} aria-label="Previous week">‹</ActionIcon>
          <Button size="xs" variant="default" onClick={() => setWeekPick(weekStart(today))}>This week</Button>
          <ActionIcon variant="default" onClick={() => setWeekPick(week + 7)} aria-label="Next week">›</ActionIcon>
        </Group>
        <Text size="sm" fw={600}>{fmtDate(dayStr(week))} – {fmtDate(dayStr(week + 6))}</Text>
        {data.snapshotAt && (
          <Badge variant="light" color={snapshotDays != null && snapshotDays > 2 ? "yellow" : "gray"}>App data as of {fmtDate(data.snapshotAt.slice(0, 10))}</Badge>
        )}
        <SyncDatabaseButton />
      </Group>

      <Group gap="sm" wrap="wrap">
        <StatTile label="Throws this week" value={weekThrows} sub={uncounted ? `+ ${uncounted} throwing day${uncounted === 1 ? "" : "s"} with no count` : "plyos + throwing"} />
        <StatTile label="High-intensity days" value={highDays} sub="intensity 80+" />
        <StatTile label="Off days" value={offDays} />
        <StatTile label="Plyo sets logged" value={plyoSets ? `${plyoDone} / ${plyoSets}` : "—"} sub="days up to today" />
      </Group>

      <div className="card" style={{ marginBottom: 0 }}>
        <WeekGrid dates={weekDays.map((d) => d.date)} today={today} setHover={setHover} chart={chart}
          cell={(date) => <DayCell key={date} date={date} day={byDate.get(date) ?? null} today={today} />} />
        <Group gap="md" mt="sm">
          <SeriesKey color={INTENSITY_COLOR}>Intensity (0–100)</SeriesKey>
          <SeriesKey color={VOLUME_COLOR}>Volume (% of the heaviest day in the program, {maxVolume} throws)</SeriesKey>
          <Tooltip multiline w={340} label="Intensity: game/live 95, max-intent 90, bullpen 80 (65 if low intent), long toss 60, flat ground 55, recovery/catch 35; plyo days scale with the routine's level (15–60). Volume: plyo reps plus a throw count written in the throwing activity's name or description.">
            <Text size="xs" c="dimmed" style={{ textDecoration: "underline dotted", cursor: "help" }}>How these are estimated</Text>
          </Tooltip>
        </Group>
      </div>
    </Stack>
  );
}
