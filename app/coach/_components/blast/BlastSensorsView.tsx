"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Alert, Badge, Button, Group, Loader, Modal, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { coachFetcher } from "../fetcher";
import type { BlastAssignmentRow, BlastAthleteHit, BlastSensorState, BlastState } from "@/lib/blast/service";

const STATE_KEY = "/api/coach/blast";
const TZ = "America/New_York";

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }) : "";
const since = (iso: string) => {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
};
const dayLabel = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";

async function send<T>(url: string, method: "POST" | "PATCH", body: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; extra: Record<string, unknown> }> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false, status: res.status, error: String(json.error ?? `Request failed (${res.status})`), extra: json };
  return { ok: true, data: json as T };
}

const END_TEXT: Record<string, string> = { ended: "ended", reassigned: "reassigned", moved: "moved to another sensor", day_end: "end of day" };

/**
 * /coach/blast: which Blast sensor is on which hitter, right now.
 * Built for a phone in the cage: one big card per sensor, tap to put a hitter on it.
 * The nightly Blast CSV load gives each swing to whoever the sensor was on at that time.
 */
export function BlastSensorsView() {
  const { data, error, isLoading, mutate } = useSWR<BlastState>(STATE_KEY, (u: string) => coachFetcher<BlastState>(u), {
    revalidateOnFocus: true,
    dedupingInterval: 2_000,
  });
  const [picking, setPicking] = useState<{ mode: "assign"; sensor: BlastSensorState } | { mode: "fix"; row: BlastAssignmentRow } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ color: string; text: string } | null>(null);
  const [showSensors, setShowSensors] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000); // keeps "on for 12 min" current; no network
    return () => clearInterval(t);
  }, []);

  const active = useMemo(() => (data?.sensors ?? []).filter((s) => s.active), [data]);

  async function run<T>(key: string, fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, done?: string) {
    setBusy(key);
    setMessage(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setMessage({ color: "red", text: r.error });
    else if (done) setMessage({ color: "green", text: done });
    await mutate();
    return r;
  }

  const assign = (sensor: BlastSensorState, athlete: { athleteUuid: string; name: string }) =>
    run(`assign:${sensor.serial}`, () => send<{ movedFrom: string | null }>("/api/coach/blast/assignments", "POST", { sensorSerial: sensor.serial, athleteUuid: athlete.athleteUuid }),
      `${sensor.label} → ${athlete.name}`);
  const patch = (row: BlastAssignmentRow, body: Record<string, unknown>, done: string) =>
    run(`row:${row.id}`, () => send(`/api/coach/blast/assignments/${row.id}`, "PATCH", body), done);

  if (isLoading) return <Loader m="xl" />;
  if (error || !data) {
    return <Alert color="red" title="Couldn't load Blast sensors">{String((error as Error)?.message ?? "Unknown error")}</Alert>;
  }

  return (
    <Stack gap="md" maw={980} mx="auto">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Text fw={700} fz="xl">Blast sensors</Text>
          <Text fz="sm" c="dimmed">
            Tap a sensor to put a hitter on it. It stays on them until you change it, end it, or nobody swings it for {data.idleMinutes} min.
          </Text>
        </div>
        <Button variant="subtle" size="xs" onClick={() => setShowSensors(true)}>Manage sensors</Button>
      </Group>

      {message && <Alert color={message.color} withCloseButton onClose={() => setMessage(null)}>{message.text}</Alert>}

      {active.length === 0 ? (
        <Alert color="yellow" title="No sensors yet">
          Add the four sensors (serial number from the Blast app + the number you call each one) under Manage sensors. A sensor also shows up
          here by itself the first time its swings come in.
        </Alert>
      ) : (
        <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="sm">
          {active.map((s) => (
            <SensorCard key={s.serial} sensor={s} busy={busy}
              onAssign={() => setPicking({ mode: "assign", sensor: s })}
              onEnd={() => s.current && patch(s.current, { action: "end" }, `${s.label} is free`)} />
          ))}
        </SimpleGrid>
      )}

      <TodayLog rows={data.today} busy={busy}
        onFix={(row) => setPicking({ mode: "fix", row })}
        onVoid={(row) => {
          if (window.confirm(`Remove ${row.athleteName} on ${row.sensorLabel} (${clock(row.startedAt)})? Its swings won't count for anyone.`)) {
            void patch(row, { action: "void" }, "Removed");
          }
        }}
        onEnd={(row) => patch(row, { action: "end" }, `${row.sensorLabel} is free`)} />

      <Text fz="xs" c="dimmed">
        Swings last loaded {dayLabel(data.lastLoadAt)}.
        {data.needsReview.length > 0 && (
          <> Swings with no hitter in the last week: {data.needsReview.map((r) => `${r.localDate} sensor ${r.sensorLabel}: ${r.swings} ${r.status}`).join(" · ")}.</>
        )}
      </Text>

      <AthletePicker
        key={picking ? "open" : "closed"} // fresh search box every time it opens
        opened={!!picking}
        title={picking?.mode === "assign" ? `Who has sensor ${picking.sensor.label}?` : picking ? `Who really had ${picking.row.sensorLabel} at ${clock(picking.row.startedAt)}?` : ""}
        onClose={() => setPicking(null)}
        onPick={async (a) => {
          const p = picking;
          setPicking(null);
          if (p?.mode === "assign") await assign(p.sensor, a);
          else if (p?.mode === "fix") await patch(p.row, { action: "change_athlete", athleteUuid: a.athleteUuid }, `Changed to ${a.name}`);
        }}
      />
      <SensorAdmin opened={showSensors} onClose={() => setShowSensors(false)} sensors={data.sensors} onChanged={() => mutate()} />
    </Stack>
  );
}

function SensorCard({ sensor, busy, onAssign, onEnd }: { sensor: BlastSensorState; busy: string | null; onAssign: () => void; onEnd: () => void }) {
  const cur = sensor.current;
  return (
    <div style={{ border: `2px solid ${cur ? "var(--accent)" : "var(--border)"}`, borderRadius: 12, padding: 14, background: "var(--card-bg)" }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Text fw={800} fz={34} lh={1}>{sensor.label}</Text>
        <Badge color={cur ? "green" : "gray"} variant="light">{cur ? "On" : "Free"}</Badge>
      </Group>
      <div style={{ minHeight: 52, marginTop: 8 }}>
        {cur ? (
          <>
            <Text fw={700} fz="lg" lineClamp={1}>{cur.athleteName}</Text>
            <Text fz="xs" c="dimmed">since {clock(cur.startedAt)} · {since(cur.startedAt)}</Text>
          </>
        ) : (
          <Text fz="sm" c="dimmed">Nobody</Text>
        )}
      </div>
      <Group gap="xs" mt="xs" grow>
        <Button size="md" onClick={onAssign} loading={busy === `assign:${sensor.serial}`}>{cur ? "Change" : "Assign"}</Button>
        {cur && <Button size="md" variant="default" onClick={onEnd} loading={busy === `row:${cur.id}`}>End</Button>}
      </Group>
    </div>
  );
}

function TodayLog({ rows, busy, onFix, onVoid, onEnd }: {
  rows: BlastAssignmentRow[]; busy: string | null;
  onFix: (r: BlastAssignmentRow) => void; onVoid: (r: BlastAssignmentRow) => void; onEnd: (r: BlastAssignmentRow) => void;
}) {
  if (!rows.length) return null;
  return (
    <div>
      <Text fw={700} mb={6}>Today</Text>
      <Stack gap={6}>
        {rows.map((r) => (
          <Group key={r.id} justify="space-between" wrap="wrap" gap="xs"
            style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", opacity: r.voided ? 0.45 : 1 }}>
            <div style={{ minWidth: 0 }}>
              <Text fz="sm" fw={600} td={r.voided ? "line-through" : undefined}>
                {r.sensorLabel} · {r.athleteName}
              </Text>
              <Text fz="xs" c="dimmed">
                {clock(r.startedAt)} – {r.voided ? "removed" : r.endedAt ? `${clock(r.endedAt)} (${END_TEXT[r.endReason ?? ""] ?? r.endReason})` : "now"}
                {r.assignedByName ? ` · ${r.assignedByName}` : ""}
              </Text>
            </div>
            {!r.voided && (
              <Group gap={4}>
                {!r.endedAt && <Button size="compact-xs" variant="default" onClick={() => onEnd(r)} loading={busy === `row:${r.id}`}>End</Button>}
                <Button size="compact-xs" variant="subtle" onClick={() => onFix(r)}>Wrong hitter</Button>
                <Button size="compact-xs" variant="subtle" color="red" onClick={() => onVoid(r)}>Remove</Button>
              </Group>
            )}
          </Group>
        ))}
      </Stack>
    </div>
  );
}

function Tags({ a }: { a: BlastAthleteHit }) {
  return (
    <Group gap={4}>
      {a.recentBlast && <Badge size="xs" variant="light" color="blue">Blast</Badge>}
      {a.hitting && <Badge size="xs" variant="light" color="teal">Hitting 3D</Badge>}
      {a.screen && <Badge size="xs" variant="light" color="grape">Screen</Badge>}
      {a.ageGroup && <Badge size="xs" variant="outline" color="gray">{a.ageGroup}</Badge>}
    </Group>
  );
}

function AthletePicker({ opened, title, onClose, onPick }: {
  opened: boolean; title: string; onClose: () => void; onPick: (a: { athleteUuid: string; name: string }) => void;
}) {
  const [q, setQ] = useState("");
  const [debounced] = useDebouncedValue(q, 200);
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useSWR<{ athletes: BlastAthleteHit[] }>(
    opened && !adding ? `/api/coach/blast/athletes?q=${encodeURIComponent(debounced.trim())}` : null,
    (u: string) => coachFetcher<{ athletes: BlastAthleteHit[] }>(u),
    { revalidateOnFocus: false },
  );
  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={700}>{title}</Text>} fullScreen={typeof window !== "undefined" && window.innerWidth < 600} size="lg">
      {adding ? (
        <NewAthleteForm initialName={q} onCancel={() => setAdding(false)} onPick={onPick} />
      ) : (
        <Stack gap="sm">
          <TextInput data-autofocus size="md" placeholder="Search any athlete…" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
          {!debounced.trim() && <Text fz="xs" c="dimmed">Recent Blast hitters. Type to search everyone in the database.</Text>}
          {isLoading && <Loader size="sm" />}
          <Stack gap={4}>
            {(data?.athletes ?? []).map((a) => (
              <button key={a.athleteUuid} type="button" onClick={() => onPick(a)}
                style={{ textAlign: "left", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", background: "var(--card-bg)", color: "inherit", cursor: "pointer" }}>
                <Group justify="space-between" wrap="nowrap">
                  <div style={{ minWidth: 0 }}>
                    <Text fw={600}>{a.name}</Text>
                    {a.dateOfBirth && <Text fz="xs" c="dimmed">DOB {a.dateOfBirth}</Text>}
                  </div>
                  <Tags a={a} />
                </Group>
              </button>
            ))}
            {debounced.trim() && data && data.athletes.length === 0 && <Text fz="sm" c="dimmed">No one by that name.</Text>}
          </Stack>
          <Button variant="light" onClick={() => setAdding(true)}>+ New player (not in the database)</Button>
        </Stack>
      )}
    </Modal>
  );
}

function NewAthleteForm({ initialName, onCancel, onPick }: {
  initialName: string; onCancel: () => void; onPick: (a: { athleteUuid: string; name: string }) => void;
}) {
  const parts = initialName.trim().split(/\s+/);
  const [first, setFirst] = useState(parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] ?? "");
  const [last, setLast] = useState(parts.length > 1 ? parts[parts.length - 1] : "");
  const [dob, setDob] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Array<{ athleteUuid: string; name: string; dateOfBirth: string | null }>>([]);

  async function save(force: boolean) {
    setSaving(true);
    setErr(null);
    const r = await send<{ athleteUuid: string; name: string }>("/api/coach/blast/athletes", "POST",
      { firstName: first, lastName: last, dateOfBirth: dob || null, email: email || null, force });
    setSaving(false);
    if (r.ok) return onPick(r.data);
    setErr(r.error);
    setCandidates((r.extra.candidates as typeof candidates | undefined) ?? []);
  }

  return (
    <Stack gap="sm">
      <Text fz="sm" c="dimmed">Adds them to the 8ctane database so their Blast swings have a home. Email links them to their 8ctane app account later.</Text>
      <Group grow>
        <TextInput label="First name" required value={first} onChange={(e) => setFirst(e.currentTarget.value)} />
        <TextInput label="Last name" required value={last} onChange={(e) => setLast(e.currentTarget.value)} />
      </Group>
      <Group grow>
        <TextInput label="Date of birth" type="date" value={dob} onChange={(e) => setDob(e.currentTarget.value)} />
        <TextInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
      </Group>
      {err && (
        <Alert color={candidates.length ? "yellow" : "red"}>
          <Text fz="sm">{err}</Text>
          {candidates.length > 0 && (
            <Stack gap={4} mt="xs">
              {candidates.map((c) => (
                <Button key={c.athleteUuid} variant="default" size="xs" justify="space-between" onClick={() => onPick(c)}>
                  Use {c.name}{c.dateOfBirth ? ` (DOB ${c.dateOfBirth})` : ""}
                </Button>
              ))}
            </Stack>
          )}
        </Alert>
      )}
      <Group justify="space-between">
        <Button variant="subtle" onClick={onCancel}>Back to search</Button>
        <Group gap="xs">
          {candidates.length > 0 && !candidates.some((c) => c.name.toUpperCase() === `${first} ${last}`.trim().toUpperCase()) && (
            <Button variant="default" loading={saving} onClick={() => save(true)}>No, it&apos;s a new person</Button>
          )}
          <Button loading={saving} disabled={!first.trim() || !last.trim()} onClick={() => save(false)}>Add player</Button>
        </Group>
      </Group>
    </Stack>
  );
}

function SensorAdmin({ opened, onClose, sensors, onChanged }: {
  opened: boolean; onClose: () => void; sensors: BlastSensorState[]; onChanged: () => void;
}) {
  const [serial, setSerial] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(body: { serial: string; label: string }) {
    setSaving(true);
    setErr(null);
    const r = await send("/api/coach/blast/sensors", "POST", body);
    setSaving(false);
    if (!r.ok) return setErr(r.error);
    setSerial("");
    setLabel("");
    onChanged();
  }
  async function toggle(s: BlastSensorState) {
    const r = await send("/api/coach/blast/sensors", "PATCH", { serial: s.serial, active: !s.active });
    if (!r.ok) setErr(r.error);
    onChanged();
  }

  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={700}>Sensors</Text>} size="lg">
      <Stack gap="sm">
        <Text fz="sm" c="dimmed">
          Serial = the sensor serial number in the Blast app (the CSV&apos;s sensorserialnumber, e.g. 111444004664). Number = what you call it on the floor.
        </Text>
        {sensors.map((s) => (
          <Group key={s.serial} justify="space-between" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
            <div>
              <Text fw={700}>{s.label} {!s.active && <Badge size="xs" color="gray">retired</Badge>}</Text>
              <Text fz="xs" c="dimmed">{s.serial} · last swing {dayLabel(s.lastSwingAt)}</Text>
            </div>
            <Group gap={4}>
              <Button size="compact-xs" variant="subtle" onClick={() => { setSerial(s.serial); setLabel(s.label); }}>Rename</Button>
              <Button size="compact-xs" variant="subtle" color={s.active ? "red" : "green"} onClick={() => toggle(s)}>{s.active ? "Retire" : "Restore"}</Button>
            </Group>
          </Group>
        ))}
        <Group grow align="flex-end">
          <TextInput label="Serial" placeholder="111444004664" value={serial} onChange={(e) => setSerial(e.currentTarget.value)} />
          <TextInput label="Number" placeholder="664" value={label} onChange={(e) => setLabel(e.currentTarget.value)} />
          <Button loading={saving} disabled={!serial.trim() || !label.trim()} onClick={() => save({ serial: serial.trim(), label: label.trim() })}>Save</Button>
        </Group>
        {err && <Alert color="red">{err}</Alert>}
      </Stack>
    </Modal>
  );
}
