"use client";

/**
 * Program Lift tab: what the athlete's 8ctane app program has them doing, from
 * the App DB snapshot. Leads with the week at a glance (Sunday → Saturday, each
 * day's exercises by block, upper vs lower body lift volume drawn under the day
 * headers), then the body map of recently worked muscles (fading back to white
 * over ~a week), the calendar, and the selected day set by set. Clicking a day
 * anywhere moves the whole page to that day.
 */

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { ActionIcon, Alert, Badge, Button, FileButton, Group, Loader, SegmentedControl, Select, Slider, Stack, Table, Text, Tooltip } from "@mantine/core";
import type { ProgramHistory, WorkoutEntry } from "@/lib/coach/program";
import { MUSCLE_IDS, MUSCLES, type MuscleId } from "@/lib/coach/programMuscles";
import { fmtDate, swrOpts, useCoachFetcher } from "../_components/fetcher";
import { SyncDatabaseButton } from "../_components/SyncDatabaseButton";
import { useIsAdmin } from "../CoachGuard";
import { BodyMap } from "../_components/BodyMap";
import { HALF_LIFE_DAYS, LOOKBACK_DAYS, RAMP_CSS, dayNum, dayStr, heatColor, muscleHeat, type HeatMode } from "../_components/programHeat";
import { DoneMark, SeriesKey, WeekGrid, WeekLineChart, localToday, shortDate, weekDates, weekStart } from "../_components/WeekStrip";
import { dayVolume, entryLoad, entryReps, regionShare, weightRefs, type WeightRefs } from "../_components/liftVolume";
import { SectionHead, StatTile } from "./shared";

export const programKey = (uuid: string) => `/api/coach/athletes/${encodeURIComponent(uuid)}/program`;

const CATEGORY_LABEL: Record<WorkoutEntry["category"], string> = {
  lift: "Lift", superset: "Superset", prep: "Prep", bulletproofing: "Bulletproofing", movement: "Movement",
};
const BLOCK_ORDER: WorkoutEntry["category"][] = ["prep", "lift", "superset", "bulletproofing", "movement"];
const CAL_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const UPPER_COLOR = "#4a90e2";
const LOWER_COLOR = "#f05252";
const MARK_COLOR = { done: "#2f9e62", missed: "#a8423a" } as const;

const agoText = (n: number) => (n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`);
/** Lifts and supersets share one sequence on a lift day, so they sort together by the app's order. */
const blockRank = (c: WorkoutEntry["category"]) => (c === "superset" ? BLOCK_ORDER.indexOf("lift") : BLOCK_ORDER.indexOf(c));
const byBlock = (a: WorkoutEntry, b: WorkoutEntry) =>
  blockRank(a.category) - blockRank(b.category) || (a.order ?? 999) - (b.order ?? 999) || (a.subOrder ?? 0) - (b.subOrder ?? 0);

interface BlockItem { e: WorkoutEntry; tag: string | null }
/** A day's exercises as display blocks; supersets fold into Lift with A1/A2… tags. */
function dayBlocks(es: WorkoutEntry[]): Array<{ key: string; label: string; items: BlockItem[] }> {
  const groups = new Map<number, string>();
  const subs = new Map<number, number>();
  const out = new Map<string, { key: string; label: string; items: BlockItem[] }>();
  for (const e of es) {
    const key = e.category === "superset" ? "lift" : e.category;
    let tag: string | null = null;
    if (e.category === "superset" && e.group != null) {
      if (!groups.has(e.group)) groups.set(e.group, String.fromCharCode(65 + groups.size));
      const k = (subs.get(e.group) ?? 0) + 1;
      subs.set(e.group, k);
      tag = `${groups.get(e.group)}${k}`;
    }
    const b = out.get(key) ?? out.set(key, { key, label: CATEGORY_LABEL[key as WorkoutEntry["category"]], items: [] }).get(key)!;
    b.items.push({ e, tag });
  }
  return [...out.values()];
}

/** "8", "8/side", "30s", "5 breaths", "20 yd". */
function repText(unit: string | null, r: number): string {
  switch (unit) {
    case "PER_SIDE": return `${r}/side`;
    case "SECONDS": return `${r}s`;
    case "SECONDS_PER_SIDE": return `${r}s/side`;
    case "BREATHS": return `${r} breaths`;
    case "BREATHS_PER_SIDE": return `${r} breaths/side`;
    case "YARDS": return `${r} yd`;
    default: return String(r);
  }
}

function weightText(e: WorkoutEntry, unit = " lb"): string {
  const w = e.weight.filter((x) => x > 0);
  if (!w.length) return "";
  return w.every((x) => x === w[0]) ? ` @ ${w[0]}${unit}` : ` @ ${w.join("/")}${unit}`;
}

/** Compact version for the week cells: "4×5 @ 225". */
function shortRx(e: WorkoutEntry): string {
  if (!e.reps.length) return e.sets ? `${e.sets} sets` : "";
  const same = e.reps.every((r) => r === e.reps[0]);
  return (same ? `${e.sets}×${repText(e.repUnit, e.reps[0]!)}` : e.reps.map((r) => repText(e.repUnit, r)).join(", ")) + weightText(e, "");
}

interface DayStatus { color: string; label: string; short: string; border?: string }

/** Completion status for a workout day (done / partial / missed / not logged / upcoming). */
function dayStatus(es: WorkoutEntry[], today: string): DayStatus {
  const sets = es.reduce((a, e) => a + e.sets, 0);
  const done = es.reduce((a, e) => a + (e.completed ?? 0), 0);
  const logged = es.some((e) => e.completed != null);
  const date = es[0]!.date;
  if (date > today) return { color: "transparent", label: `Scheduled · ${sets} sets`, short: `${sets} sets`, border: "1px dashed var(--text-muted)" };
  if (!logged) return { color: "#3a4658", label: `Not logged · ${sets} sets scheduled`, short: "Not logged" };
  const r = sets ? done / sets : 0;
  if (r >= 0.9) return { color: "#2f9e62", label: `Done · ${done}/${sets} sets`, short: `Done ${done}/${sets}` };
  if (r > 0) return { color: "#c9902c", label: `Partly done · ${done}/${sets} sets`, short: `${done}/${sets} sets` };
  return { color: "#a8423a", label: `Nothing marked done · 0/${sets} sets`, short: `0/${sets} sets` };
}

function LiftDayCell({ date, entries, today, selected, onSelect }: {
  date: string;
  entries: WorkoutEntry[] | undefined;
  today: string;
  selected: boolean;
  onSelect: (d: string) => void;
}) {
  const st = entries ? dayStatus(entries, today) : null;
  const blocks = dayBlocks(entries ?? []);
  return (
    <div role="button" tabIndex={0} onClick={() => onSelect(date)} onKeyDown={(ev) => { if (ev.key === "Enter") onSelect(date); }}
      style={{
        background: "var(--bg-inset)", borderRadius: 8, padding: "8px 9px", minHeight: 140, fontSize: "0.8rem", minWidth: 0, cursor: "pointer",
        border: selected ? "1px solid var(--text-primary)" : date === today ? "1px solid var(--accent)" : "1px solid var(--border-soft)",
        display: "flex", flexDirection: "column", gap: 8,
      }}>
      {!st && <Text size="xs" c="dimmed">Rest</Text>}
      {st && (
        <Group gap={6} wrap="nowrap">
          <span style={{ width: 9, height: 9, borderRadius: 3, flex: "none", background: st.color, border: st.border }} />
          <Text size="xs" c="dimmed" truncate>{st.short}</Text>
        </Group>
      )}
      {blocks.map(({ key, label, items }) => key !== "lift" ? (
        <div key={key} style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", columnGap: 6, alignItems: "baseline" }}
          title={items.map(({ e }) => e.name).join(" · ")}>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">{label}</Text>
          <Text size="xs" c="dimmed">
            {(() => {
              const sets = items.reduce((a, { e }) => a + e.sets, 0);
              const logged = items.some(({ e }) => e.completed != null);
              const done = items.reduce((a, { e }) => a + (e.completed ?? 0), 0);
              return `${items.length} ex · ${logged ? `${done}/${sets}` : sets} sets`;
            })()}
          </Text>
        </div>
      ) : (
        <div key={key}>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={3} style={{ lineHeight: 1.3 }}>{label}</Text>
          {items.map(({ e, tag }, i) => (
            <div key={`${e.exerciseId}-${i}`} style={{ display: "flex", flexWrap: "wrap", columnGap: 6, justifyContent: "space-between", alignItems: "baseline", marginBottom: 3, lineHeight: 1.3 }}>
              <span style={{ minWidth: 0 }}>
                <DoneMark done={e.completed} sets={e.sets} />
                {tag && <span style={{ color: "var(--text-muted)", marginRight: 4 }}>{tag}</span>}
                {e.name}
              </span>
              <span style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{shortRx(e)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** One day set by set: reps, weight (logged vs prescribed), done/missed, volume and muscles. */
function DayDetail({ date, entries, today, refs }: { date: string; entries: WorkoutEntry[]; today: string; refs: WeightRefs }) {
  if (!entries.length) {
    return (
      <div className="card" style={{ marginBottom: 0 }}>
        <SectionHead title={fmtDate(date)} sub="rest day" />
      </div>
    );
  }
  const st = dayStatus(entries, today);
  const rx = dayVolume(entries, "prescribed", refs);
  const logged = entries.some((e) => e.completed != null);
  const done = logged ? dayVolume(entries, "completed", refs) : null;
  const tonnage = entries.reduce((a, e) => a + e.reps.reduce((t, r, i) => t + (e.setMarks?.[i] === "done" && (e.weight[i] ?? 0) > 0 && (!e.repUnit || e.repUnit === "REPS" || e.repUnit === "PER_SIDE") ? r * e.weight[i]! : 0), 0), 0);
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <Group justify="space-between" align="flex-start" mb="sm" wrap="wrap">
        <SectionHead title={`${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" })} · ${fmtDate(date)}${date > today ? " (upcoming)" : ""}`} sub={`${entries.length} exercises · ${st.label}`} />
        <Group gap="xs">
          <Badge variant="light" color="blue">Upper {done ? `${done.upper} / ` : ""}{rx.upper} vol</Badge>
          <Badge variant="light" color="red">Lower {done ? `${done.lower} / ` : ""}{rx.lower} vol</Badge>
          {tonnage > 0 && <Badge variant="light" color="gray">{tonnage.toLocaleString()} lb moved</Badge>}
        </Group>
      </Group>
      <Table fz="sm" verticalSpacing={6} highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: 54 }} />
            <Table.Th>Exercise</Table.Th>
            <Table.Th>Sets (reps × lb)</Table.Th>
            <Table.Th ta="right">Done</Table.Th>
            <Table.Th ta="right">Reps</Table.Th>
            <Table.Th>Muscles</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {dayBlocks(entries).flatMap(({ key, label, items }) => [
            <Table.Tr key={`${key}-h`}>
              <Table.Td colSpan={6} style={{ paddingTop: 12 }}><Text size="xs" fw={700} tt="uppercase" c="dimmed">{label}</Text></Table.Td>
            </Table.Tr>,
            ...items.map(({ e, tag }, i) => {
              const sets = Math.max(e.reps.length, e.sets);
              const share = regionShare(e);
              return (
                <Table.Tr key={`${key}-${e.exerciseId}-${i}`}>
                  <Table.Td><Text size="xs" c="dimmed">{tag ?? ""}</Text></Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500}>{e.name}</Text>
                    {e.notes && <Text size="xs" c="dimmed" lineClamp={2} title={e.notes}>{e.notes}</Text>}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {Array.from({ length: sets }, (_, k) => {
                        const r = e.reps[k] ?? e.reps[e.reps.length - 1] ?? 0;
                        const w = e.weight[k] ?? 0;
                        const rw = e.rxWeight?.[k] ?? 0;
                        const mark = e.setMarks?.[k] ?? null;
                        return (
                          <Tooltip key={k} label={`Set ${k + 1}: ${mark === "done" ? "done" : mark === "missed" ? "not done" : "not logged"}${rw && rw !== w ? ` · prescribed ${rw} lb` : ""}`} withArrow>
                            <span style={{
                              fontSize: "0.75rem", padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap",
                              background: "var(--bg-inset)", border: `1px solid ${mark ? MARK_COLOR[mark] : "var(--border-soft)"}`,
                              color: mark === "missed" ? "var(--text-secondary)" : "var(--text-primary)",
                              textDecoration: mark === "missed" ? "line-through" : undefined,
                            }}>
                              {repText(e.repUnit, r)}{w > 0 ? ` × ${w}` : ""}{rw && rw !== w ? <span style={{ color: "var(--text-muted)" }}> (Rx {rw})</span> : null}
                            </span>
                          </Tooltip>
                        );
                      })}
                    </Group>
                  </Table.Td>
                  <Table.Td ta="right">{e.completed == null ? <Text span size="xs" c="dimmed">not logged</Text> : `${e.completed}/${sets}`}</Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm">{e.completed != null ? `${Math.round(entryReps(e, "completed"))} / ` : ""}{Math.round(entryReps(e, "prescribed"))}</Text>
                    {(() => {
                      const load = entryLoad(e, refs);
                      const region = share.upper >= 0.99 ? "upper" : share.lower >= 0.99 ? "lower" : share.upper > 0 || share.lower > 0 ? `${Math.round(share.upper * 100)}% upper` : "";
                      const parts = [region, load < 0.97 ? `${Math.round(load * 100)}% of top wt` : ""].filter(Boolean);
                      return parts.length ? <Text size="xs" c={load < 0.97 ? "yellow" : "dimmed"}>{parts.join(" · ")}</Text> : null;
                    })()}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c={e.muscleSource === "type" ? "dimmed" : undefined}>
                      {[...e.primary.map((m) => MUSCLES[m as MuscleId]), ...e.secondary.map((m) => `${MUSCLES[m as MuscleId]} (2°)`)].join(", ") || "—"}
                      {e.muscleSource === "type" ? " · guessed from type" : ""}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              );
            }),
          ])}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed" mt="xs">
        Green border = set done, red = not done, grey = not logged. Reps column: completed / prescribed reps (per-side reps count both sides); &quot;% of top wt&quot; = the day&apos;s weight against the heaviest the athlete has for that exercise in this program.
        Weights are what the app has for each set{entries.some((e) => (e.rxWeight ?? []).some((w, k) => w !== e.weight[k])) ? "; (Rx …) shows the prescribed weight where the athlete logged something different" : ""}.
      </Text>
    </div>
  );
}

export function ProgramTab({ athleteUuid }: { athleteUuid: string }) {
  const { data, error, isLoading } = useSWR<ProgramHistory>(programKey(athleteUuid), swrOpts);
  const today = localToday();
  const [programPick, setProgramPick] = useState<string | null>(null);
  const [modePick, setModePick] = useState<HeatMode | null>(null);
  const [focusPick, setFocusPick] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const programs = data?.programs ?? [];
  const current = programs.find((p) => p.start <= today && (!p.end || p.end >= today)) ?? programs[0];
  const programId = programPick ?? (current ? String(current.id) : "all");
  const entries = useMemo(
    () => (data?.entries ?? []).filter((e) => programId === "all" || String(e.programId) === programId),
    [data, programId],
  );
  const past = useMemo(() => entries.filter((e) => e.date <= today), [entries, today]);
  const anyLogged = past.some((e) => (e.completed ?? 0) > 0);
  const mode: HeatMode = modePick ?? (anyLogged ? "completed" : "prescribed");

  const byDay = useMemo(() => {
    const m = new Map<string, WorkoutEntry[]>();
    for (const e of entries) (m.get(e.date) ?? m.set(e.date, []).get(e.date)!).push(e);
    for (const es of m.values()) es.sort(byBlock);
    return m;
  }, [entries]);

  // The page follows one focus day: the week shown, the body map's as-of date,
  // the calendar's last row and the detail table. Default: today while the
  // program is running, else its last past workout (or first day if not started).
  const firstDate = entries.length ? entries[entries.length - 1]!.date : today;
  const lastDate = entries.length ? entries[0]!.date : today;
  const lastPast = past[0]?.date ?? firstDate;
  const defaultFocus = today >= firstDate && today <= lastDate
    ? (dayNum(today) - dayNum(lastPast) > LOOKBACK_DAYS ? lastPast : today)
    : today > lastDate ? lastPast : firstDate;
  const focus = focusPick ?? defaultFocus;
  const asOf = focus > today ? today : focus;

  // Heaviest weight per exercise in the shown program(s) = 100% load for volume and the body map.
  const refs = useMemo(() => weightRefs(entries), [entries]);
  const heat = useMemo(() => muscleHeat(entries, asOf, mode, refs), [entries, asOf, mode, refs]);

  if (isLoading) return <Loader size="sm" />;
  if (error) return <Alert color="red">{error.message}</Alert>;
  if (!data) return null;
  if (!data.linked) return <Text c="dimmed">No 8ctane app account is matched to this athlete (check the email on the athlete profile).</Text>;
  if (!programs.length) return <Text c="dimmed">No programs in the 8ctane app for this athlete yet.</Text>;

  const snapshotDays = data.snapshotAt ? Math.floor(dayNum(today) - dayNum(data.snapshotAt.slice(0, 10))) : null;

  // ---- the focus week ----
  const week = weekStart(focus);
  const dates = weekDates(week);
  const weekEntries = dates.flatMap((d) => byDay.get(d) ?? []);
  const weekWorkoutDays = dates.filter((d) => byDay.has(d));
  const weekPastEntries = weekEntries.filter((e) => e.date <= today);
  const weekSetsDue = weekPastEntries.reduce((a, e) => a + e.sets, 0);
  const weekSetsDone = weekPastEntries.reduce((a, e) => a + (e.completed ?? 0), 0);
  const weekLoggedDays = weekWorkoutDays.filter((d) => d <= today && byDay.get(d)!.some((e) => e.completed != null)).length;
  const weekDueDays = weekWorkoutDays.filter((d) => d <= today).length;
  // Lift volume (reps) per day split upper / lower body; scale = the program's biggest single region-day.
  const weekVol = dates.map((d) => dayVolume(byDay.get(d) ?? [], "prescribed", refs));
  const weekRaw = dates.map((d) => dayVolume(byDay.get(d) ?? [], "prescribed"));
  const weekDone = dates.map((d) => {
    const es = byDay.get(d);
    return d <= today && es?.some((e) => e.completed != null) ? dayVolume(es, "completed", refs) : null;
  });
  const maxVol = Math.max(1, ...[...byDay.values()].map((es) => { const v = dayVolume(es, "prescribed", refs); return Math.max(v.upper, v.lower); }));

  // ---- program to date ----
  const pastDays = new Map<string, WorkoutEntry[]>();
  for (const e of past) (pastDays.get(e.date) ?? pastDays.set(e.date, []).get(e.date)!).push(e);
  const loggedDays = [...pastDays.values()].filter((es) => es.some((e) => (e.completed ?? 0) > 0));
  const setsPlanned = past.reduce((a, e) => a + e.sets, 0);
  const setsDone = past.reduce((a, e) => a + (e.completed ?? 0), 0);
  const lastLogged = loggedDays.map((es) => es[0]!.date).sort().at(-1) ?? null;

  // ---- calendar: 8 weeks ending with the focus week (Sunday first) ----
  const calWeeks = Array.from({ length: 8 }, (_, w) => weekDates(week - (7 - w) * 7));

  // ---- body map side list ----
  const asOfN = dayNum(asOf);
  const ranked = MUSCLE_IDS.map((m) => ({ m, ...heat[m] })).sort((a, b) => b.load - a.load);
  const worked = ranked.filter((r) => r.load >= 0.5);
  const idle = ranked.filter((r) => !r.lastDate || asOfN - dayNum(r.lastDate) >= 7).map((r) => r.m);
  const sliderMin = dayNum(firstDate);
  const sliderMax = Math.max(dayNum(today), sliderMin + 1);

  // Detail day: the picked day, else the latest workout up to the focus date
  // (so a rest-day "today" still opens on the last session).
  const detailDay = focusPick ?? ([...byDay.keys()].filter((d) => d <= asOf).sort().at(-1) ?? focus);
  const dayEntries = byDay.get(detailDay) ?? [];
  const select = (d: string) => setFocusPick(d);

  const chart = (
    <WeekLineChart
      yMax={maxVol} topLabel={`${maxVol} vol`} bottomLabel="none" hover={hover} setHover={setHover}
      series={[
        { key: "upper", label: "Upper body", color: UPPER_COLOR, values: weekVol.map((v) => v.upper) },
        { key: "lower", label: "Lower body", color: LOWER_COLOR, values: weekVol.map((v) => v.lower) },
      ]}
      tooltip={(i) => {
        const d = dates[i]!;
        const es = byDay.get(d);
        const v = weekVol[i]!;
        const done = weekDone[i];
        return (
          <>
            <div style={{ fontWeight: 600 }}>{fmtDate(d)}</div>
            {es ? (
              <>
                <div><span style={{ color: UPPER_COLOR }}>●</span> Upper {v.upper}{done ? ` · ${done.upper} done` : ""} <span style={{ color: "var(--text-muted)" }}>({weekRaw[i]!.upper} reps)</span></div>
                <div><span style={{ color: LOWER_COLOR }}>●</span> Lower {v.lower}{done ? ` · ${done.lower} done` : ""} <span style={{ color: "var(--text-muted)" }}>({weekRaw[i]!.lower} reps)</span></div>
                <div style={{ color: "var(--text-secondary)" }}>{weekRaw[i]!.total ? `Load ${Math.round((v.total / weekRaw[i]!.total) * 100)}% of top weights` : "No lift block"} · {dayStatus(es, today).label}</div>
              </>
            ) : <div style={{ color: "var(--text-secondary)" }}>Rest</div>}
          </>
        );
      }}
    />
  );

  return (
    <Stack gap="md">
      <Group gap="sm" wrap="wrap">
        <Select size="sm" w={320} value={programId} onChange={(v) => { setProgramPick(v); setFocusPick(null); }} allowDeselect={false}
          data={[
            ...programs.map((p) => ({ value: String(p.id), label: `${p.name} · ${fmtDate(p.start)}${p.end ? ` – ${fmtDate(p.end)}` : ""}${p.archived ? " (archived)" : ""}` })),
            { value: "all", label: "All programs" },
          ]} />
        <Group gap={4}>
          <ActionIcon variant="default" onClick={() => setFocusPick(dayStr(dayNum(focus) - 7))} aria-label="Previous week">‹</ActionIcon>
          <Button size="xs" variant="default" onClick={() => setFocusPick(today)}>This week</Button>
          <ActionIcon variant="default" onClick={() => setFocusPick(dayStr(dayNum(focus) + 7))} aria-label="Next week">›</ActionIcon>
        </Group>
        <Text size="sm" fw={600}>{fmtDate(dates[0]!)} – {fmtDate(dates[6]!)}</Text>
        {data.snapshotAt && (
          <Tooltip label="Program data comes from a snapshot of the 8ctane app database (OctaneAiLayer sync).">
            <Badge variant="light" color={snapshotDays != null && snapshotDays > 2 ? "yellow" : "gray"}>
              App data as of {fmtDate(data.snapshotAt.slice(0, 10))}
            </Badge>
          </Tooltip>
        )}
        <SyncDatabaseButton />
      </Group>

      <Group gap="sm" wrap="wrap">
        <StatTile label="Workout days this week" value={weekWorkoutDays.length} sub={weekDueDays ? `${weekLoggedDays} of ${weekDueDays} so far logged` : "none due yet"} />
        <StatTile label="Sets completed this week" value={weekSetsDue ? `${weekSetsDone} / ${weekSetsDue}` : "—"} sub={weekSetsDue ? `${Math.round((weekSetsDone / weekSetsDue) * 100)}% of sets due so far` : "days up to today"} />
        <StatTile label="Program sets completed" value={setsPlanned ? `${Math.round((setsDone / setsPlanned) * 100)}%` : "—"} sub={`${loggedDays.length} of ${pastDays.size} workout days logged`} />
        <StatTile label="Last logged workout" value={lastLogged ? fmtDate(lastLogged) : "—"} sub={lastLogged ? agoText(Math.round(dayNum(today) - dayNum(lastLogged))) : "nothing logged yet"} />
      </Group>

      <div className="card" style={{ marginBottom: 0 }}>
        <WeekGrid dates={dates} today={today} selected={detailDay} onSelect={select} setHover={setHover} chart={chart}
          cell={(d) => <LiftDayCell key={d} date={d} entries={byDay.get(d)} today={today} selected={d === detailDay} onSelect={select} />} />
        <Group gap="md" mt="sm">
          <SeriesKey color={UPPER_COLOR}>Upper body volume</SeriesKey>
          <SeriesKey color={LOWER_COLOR}>Lower body volume</SeriesKey>
          <Tooltip multiline w={360} label="Volume = sets × reps × load, in the Lift block (supersets included). Load is each set's weight over the heaviest weight the athlete has for that exercise in this program, so a deload at 75% of the weight reads ~75% of the volume; unweighted work counts in full. Per-side reps count both sides; timed holds, breaths and yards count 1 per set. Each exercise is split between upper and lower body by its primary muscles; core counts toward neither. Hover a day for raw reps and completed volume. The body map uses the same load weighting.">
            <Text size="xs" c="dimmed" style={{ textDecoration: "underline dotted", cursor: "help" }}>How volume is counted</Text>
          </Tooltip>
          <Text size="xs" c="dimmed">Scale: the program&apos;s biggest day ({maxVol}) · click a day to focus the body map and details</Text>
        </Group>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <SectionHead title="Muscles worked" sub={`as of ${fmtDate(asOf)} · sets weighted by load · fades by half every ${HALF_LIFE_DAYS} days`} />
        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 520px) minmax(260px, 1fr)", gap: 24, alignItems: "start" }}>
          <div>
            <BodyMap heat={heat} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: "0.75rem", color: "var(--text-secondary)" }}>
              <span>Fresh</span>
              <span style={{ flex: 1, height: 8, borderRadius: 4, background: RAMP_CSS }} />
              <span>Just trained</span>
            </div>
          </div>
          <Stack gap="sm">
            <SegmentedControl size="xs" w="fit-content" value={mode} onChange={(v) => setModePick(v as HeatMode)}
              data={[{ value: "completed", label: "Completed sets" }, { value: "prescribed", label: "Prescribed sets" }]} />
            {mode === "completed" && !anyLogged && <Text size="xs" c="yellow">Nothing logged in this program yet, so completed sets are empty.</Text>}
            <div>
              <Text size="xs" c="dimmed" mb={4}>Day</Text>
              <Slider min={sliderMin} max={sliderMax} step={1} value={Math.min(Math.max(asOfN, sliderMin), sliderMax)} onChange={(v) => setFocusPick(dayStr(v))}
                label={(v) => fmtDate(dayStr(v))} marks={[{ value: dayNum(today) <= sliderMax ? dayNum(today) : sliderMax, label: "Today" }]} mb="lg" />
            </div>
            <div>
              <Text size="sm" fw={600} mb={4}>Most worked</Text>
              {worked.length === 0 && <Text size="sm" c="dimmed">Nothing in the last {LOOKBACK_DAYS} days.</Text>}
              {worked.slice(0, 8).map((r) => (
                <div key={r.m} style={{ display: "grid", gridTemplateColumns: "150px 1fr 86px", alignItems: "center", gap: 8, fontSize: "0.82rem", marginBottom: 4 }}>
                  <span>{MUSCLES[r.m]}</span>
                  <span style={{ height: 8, borderRadius: 4, background: "var(--bg-tertiary)", position: "relative", overflow: "hidden" }}>
                    <span style={{ position: "absolute", inset: 0, width: `${Math.max(4, r.level * 100)}%`, background: heatColor(Math.max(0.35, r.level)), borderRadius: 4 }} />
                  </span>
                  <span style={{ color: "var(--text-secondary)", textAlign: "right" }}>{r.lastDate ? shortDate(r.lastDate) : ""}</span>
                </div>
              ))}
            </div>
            {idle.length > 0 && (
              <div>
                <Text size="sm" fw={600} mb={4}>Not trained in 7+ days</Text>
                <Text size="sm" c="dimmed">{idle.map((m) => MUSCLES[m]).join(" · ")}</Text>
              </div>
            )}
          </Stack>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <SectionHead title="Calendar" sub="8 weeks · click a day to jump to it" />
        <div style={{ display: "grid", gridTemplateColumns: "64px repeat(7, minmax(0, 1fr))", gap: 6 }}>
          <span />
          {CAL_WEEKDAYS.map((d) => <Text key={d} size="xs" c="dimmed" ta="center">{d}</Text>)}
          {calWeeks.map((wk) => [
            <Text key={`${wk[0]}-l`} size="xs" c={wk[0] === dates[0] ? undefined : "dimmed"} fw={wk[0] === dates[0] ? 700 : undefined} style={{ alignSelf: "center" }}>{shortDate(wk[0]!)}</Text>,
            ...wk.map((d) => {
              const es = byDay.get(d);
              const st = es ? dayStatus(es, today) : null;
              return (
                <Tooltip key={d} label={`${fmtDate(d)}${st ? ` · ${st.label}` : " · rest"}`} withArrow>
                  <button type="button" onClick={() => select(d)}
                    style={{
                      height: 40, borderRadius: 6, cursor: "pointer", padding: "0 8px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
                      background: st?.color ?? "var(--bg-inset)", border: d === detailDay ? "2px solid #fff" : (st?.border ?? "1px solid var(--border-soft)"),
                      color: "var(--text-primary)", fontSize: "0.75rem", minWidth: 0,
                    }}>
                    <span style={{ fontWeight: 600 }}>{Number(d.slice(8, 10))}</span>
                    {st && <span style={{ opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{st.short}</span>}
                  </button>
                </Tooltip>
              );
            }),
          ])}
        </div>
        <Group gap="md" mt="sm">
          {[["#2f9e62", "done"], ["#c9902c", "partly done"], ["#a8423a", "nothing marked done"], ["#3a4658", "not logged"]].map(([c, l]) => (
            <Group key={l} gap={6}><span style={{ width: 12, height: 12, borderRadius: 3, background: c }} /><Text size="xs" c="dimmed">{l}</Text></Group>
          ))}
          <Group gap={6}><span style={{ width: 12, height: 12, borderRadius: 3, border: "1px dashed var(--text-muted)" }} /><Text size="xs" c="dimmed">upcoming</Text></Group>
        </Group>
      </div>

      <DayDetail date={detailDay} entries={dayEntries} today={today} refs={refs} />

      <MuscleMappingPanel athleteUuid={athleteUuid} unmapped={data.unmapped} unknownTerms={data.unknownTerms ?? []} sourceCounts={data.sourceCounts} />
      {data.truncated && <Text size="xs" c="yellow">Showing the most recent 12,000 exercise entries.</Text>}
    </Stack>
  );
}

/**
 * Where the body map's muscles come from, plus (admins) a CSV round trip:
 * download every app exercise with its current muscles, fix it, upload it to
 * coach.exercise_muscles. Uploaded rows override the name rules.
 */
const SOURCE_LABEL: Record<keyof ProgramHistory["sourceCounts"], string> = {
  description: "app descriptions", override: "uploaded mapping", rule: "name rules", type: "guessed from type", none: "no muscles",
};

function MuscleMappingPanel({ athleteUuid, unmapped, unknownTerms, sourceCounts }: {
  athleteUuid: string;
  unmapped: ProgramHistory["unmapped"];
  unknownTerms: ProgramHistory["unknownTerms"];
  sourceCounts?: ProgramHistory["sourceCounts"];
}) {
  const isAdmin = useIsAdmin();
  const fetcher = useCoachFetcher();
  const { mutate } = useSWRConfig();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; errors?: Array<{ line: number; message: string }> } | null>(null);

  async function upload(file: File | null) {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/dashboard/program/exercise-muscles", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Upload failed (${res.status})`);
      setResult({ ok: true, text: `Saved ${json.saved} exercise${json.saved === 1 ? "" : "s"}${json.skipped ? `, skipped ${json.skipped} blank` : ""}.`, errors: json.errors });
      const key = programKey(athleteUuid);
      await mutate(key, await fetcher(key, { refresh: true }), { revalidate: false });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <SectionHead title="Muscle mapping" sub="where the body map's muscles come from" />
      <Text size="sm" c="dimmed">
        Muscles come from each exercise&apos;s description in the 8ctane app (the &quot;Primary Muscles&quot; / &quot;Secondary Muscles&quot;
        lines), so new and edited exercises update with every sync. Exercises without those lines are matched by name (squat, RDL,
        Pallof press…), then by type. An uploaded mapping overrides all of these.
      </Text>
      {sourceCounts && (() => {
        const total = Object.values(sourceCounts).reduce((a, b) => a + b, 0);
        if (!total) return null;
        return (
          <Text size="xs" mt={6}>
            This athlete&apos;s exercises:{" "}
            {(Object.keys(SOURCE_LABEL) as Array<keyof typeof SOURCE_LABEL>).filter((k) => sourceCounts[k] > 0)
              .map((k) => `${Math.round((sourceCounts[k] / total) * 100)}% ${SOURCE_LABEL[k]}`).join(" · ")}
          </Text>
        );
      })()}
      {isAdmin && (
        <Group gap="sm" mt="sm">
          <Button component="a" href="/api/dashboard/program/exercise-muscles" size="xs" variant="light">Download exercises (CSV)</Button>
          <FileButton onChange={(f) => void upload(f)} accept=".csv,text/csv">
            {(props) => <Button {...props} size="xs" variant="light" loading={busy}>Upload mapping (CSV)</Button>}
          </FileButton>
          <Text size="xs" c="dimmed">Muscles separated by &quot;;&quot; · use &quot;none&quot; for no muscles</Text>
        </Group>
      )}
      {result && (
        <Text size="sm" mt="xs" c={result.ok ? "green" : "red"}>
          {result.text}{result.errors?.length ? ` ${result.errors.length} row${result.errors.length === 1 ? "" : "s"} not saved: ${result.errors.slice(0, 5).map((e) => `line ${e.line} (${e.message})`).join("; ")}` : ""}
        </Text>
      )}
      {unknownTerms.length > 0 && (
        <Text size="xs" c="yellow" mt="sm">
          Muscle words in descriptions the map doesn&apos;t know yet (ignored): {unknownTerms.map((u) => `"${u.term}" (${u.exercises.join(", ")})`).join(" · ")}
        </Text>
      )}
      {unmapped.length > 0 && (
        <Text size="xs" c="dimmed" mt="sm">
          Not mapped for this athlete: {unmapped.map((u) => `${u.name} (${u.count})`).join(" · ")}
        </Text>
      )}
    </div>
  );
}
