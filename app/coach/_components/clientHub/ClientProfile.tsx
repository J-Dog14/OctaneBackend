"use client";

/**
 * One client: program periods (with coach-editable start/end), what's happening in the app,
 * assessments, onboarding, programming updates, contract, details and the coach log.
 * Shown at /coach/clients/:id (from the Client Hub) and in an active programmer's
 * "Program Management" tab on the athlete page — same component, two routes.
 * Every field saves on change; each edit is logged with who made it.
 */

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Alert, Anchor, Badge, Button, Checkbox, Group, Loader, Select, SimpleGrid, Stack, Switch, Text, Textarea, TextInput, Title, Tooltip,
} from "@mantine/core";
import { PHASES, PROGRAM_TYPE_LABEL, PROGRAM_TYPES, UPDATE_FIELDS } from "@/lib/client-hub/constants";
import type { HubPeriod } from "@/lib/client-hub/types";
import { detailKey, fmtDay, HUB, HubError, hubGet, hubSend, hubSwr, STATUS_COLOR, STATUS_LABEL, TONE_COLOR, type HubDetail } from "./api";

type Save = (patch: Record<string, unknown>) => Promise<void>;

// ---------------------------------------------------------------------------
// Small inputs that save themselves
// ---------------------------------------------------------------------------

/** Uncontrolled and re-keyed on the saved value, so a refetch shows the new value without effect-driven state. */
function DateField({ label, value, onSave, hint, w = 150 }: { label?: string; value: string | null; onSave: (v: string | null) => void; hint?: React.ReactNode; w?: number }) {
  return (
    <TextInput
      key={value ?? ""} type="date" size="xs" label={label} description={hint} defaultValue={value ?? ""} w={w}
      onBlur={(e) => {
        const v = e.currentTarget.value || null;
        if (v !== (value || null)) onSave(v);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

function TextField({ label, value, onSave, placeholder, w }: { label: string; value: string | null; onSave: (v: string | null) => void; placeholder?: string; w?: number | string }) {
  return (
    <TextInput key={value ?? ""} size="xs" label={label} defaultValue={value ?? ""} placeholder={placeholder} w={w}
      onBlur={(e) => {
        const v = e.currentTarget.value.trim();
        if (v !== (value ?? "")) onSave(v || null);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
  );
}

function Card({ title, sub, right, children }: { title: string; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <Group justify="space-between" align="flex-start" mb="sm" wrap="nowrap">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <h2>{title}</h2>
          {sub && <span className="card-sub">{sub}</span>}
        </div>
        {right}
      </Group>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Program periods
// ---------------------------------------------------------------------------

function periodState(p: HubPeriod): { label: string; color: string } {
  if (p.isCurrent) return { label: "Current", color: "green" };
  if (p.removedInApp) return { label: "Removed in app", color: "red" };
  if (p.appArchived) return { label: "Archived in app", color: "gray" };
  return { label: "Ended", color: "gray" };
}

function PeriodRow({ p, clientId, onChanged, onError }: { p: HubPeriod; clientId: string; onChanged: () => void; onError: (m: string) => void }) {
  const url = `${HUB}/clients/${clientId}/programs/${p.id}`;
  const patch = async (body: Record<string, unknown>) => {
    try {
      await hubSend("PATCH", url, body);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const st = periodState(p);
  const fromApp = p.source === "app";
  const overridden = (o: string | null, app: string | null, field: "startOverride" | "endOverride") =>
    o && fromApp ? (
      <span>
        app: {fmtDay(app)} · <Anchor size="xs" component="button" onClick={() => void patch({ [field]: null })}>use app date</Anchor>
      </span>
    ) : null;
  return (
    <tr>
      <td>
        <div style={{ fontWeight: 600 }}>{p.name ?? "Program"}</div>
        <Group gap={4}>
          {p.programType && <Badge size="xs" variant="outline">{PROGRAM_TYPE_LABEL[p.programType]}</Badge>}
          <Badge size="xs" variant="light" color={st.color}>{st.label}</Badge>
          {!fromApp && <Badge size="xs" variant="light" color="grape">Added in hub</Badge>}
        </Group>
        {p.coachNames.length > 0 && <Text size="xs" c="dimmed">Coach: {p.coachNames.join(", ")}</Text>}
      </td>
      <td><DateField value={p.startDate} hint={overridden(p.startOverride, p.appStart, "startOverride")} onSave={(v) => void patch({ startOverride: v })} /></td>
      <td><DateField value={p.endDate} hint={overridden(p.endOverride, p.appEnd, "endOverride")} onSave={(v) => void patch({ endOverride: v })} /></td>
      <td style={{ whiteSpace: "nowrap" }}>
        {p.spanDays != null ? `${p.spanDays} days` : "—"}
        {p.appLastDay && <Text size="xs" c="dimmed">built through {fmtDay(p.appLastDay, false)}</Text>}
      </td>
      <td>
        {!fromApp && (
          <Button size="compact-xs" variant="subtle" color="red" onClick={async () => {
            try { await hubSend("DELETE", url); onChanged(); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
          }}>Delete</Button>
        )}
      </td>
    </tr>
  );
}

function AddPeriod({ clientId, onDone, onError }: { clientId: string; onDone: () => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  if (!open) return <Button size="compact-xs" variant="subtle" onClick={() => setOpen(true)}>+ Add a program period</Button>;
  return (
    <Group gap="xs" align="flex-end" mt="xs" wrap="wrap">
      <TextInput size="xs" label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} w={180} />
      <Select size="xs" label="Type" data={PROGRAM_TYPES.map((t) => ({ value: t, label: PROGRAM_TYPE_LABEL[t] }))} value={type} onChange={setType} w={120} clearable />
      <TextInput size="xs" type="date" label="Start" value={start} onChange={(e) => setStart(e.currentTarget.value)} />
      <TextInput size="xs" type="date" label="End" value={end} onChange={(e) => setEnd(e.currentTarget.value)} />
      <Button size="xs" disabled={!name.trim() || !start} onClick={async () => {
        try {
          await hubSend("POST", `${HUB}/clients/${clientId}/programs`, { name: name.trim(), programType: type, start, end: end || null });
          setOpen(false); setName(""); setStart(""); setEnd(""); onDone();
        } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
      }}>Add</Button>
      <Button size="xs" variant="subtle" onClick={() => setOpen(false)}>Cancel</Button>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// In the app: 14-day strip + next 7 days
// ---------------------------------------------------------------------------

function AppCard({ d }: { d: HubDetail }) {
  const c = d.calendar;
  const cov = d.row.coverage;
  return (
    <Card title="In the app" sub={d.snapshotAt ? `snapshot ${new Date(d.snapshotAt).toLocaleString()}` : undefined}>
      <Group gap="xl" mb="sm">
        <div>
          <Text size="xs" c="dimmed">Programmed through</Text>
          <Text fw={700} style={{ color: TONE_COLOR[cov.tone] }}>{cov.label}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">Checked off · last 7 days</Text>
          <Text fw={700} style={{ color: TONE_COLOR[d.row.weekTone] }}>{d.row.week ? (d.row.week.trackable ? `${d.row.week.done}/${d.row.week.trackable} sets` : "Nothing to tick") : "—"}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">Last tick</Text>
          <Text fw={700}>{fmtDay(d.client.lastTick)}</Text>
        </div>
      </Group>
      {d.calendarError && <Alert color="yellow" mb="sm">{d.calendarError}</Alert>}
      {c && (
        <>
          <Text size="xs" c="dimmed" mb={4}>Last 14 days · {c.last14.done}/{c.last14.trackable} sets</Text>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${c.strip.length}, 1fr)`, gap: 3, marginBottom: 12 }}>
            {c.strip.map((s) => (
              <Tooltip key={s.date} label={`${fmtDay(s.date, false)} · ${s.trackable ? `${s.done}/${s.trackable} sets` : s.scheduled ? "nothing trackable" : "nothing scheduled"}`}>
                <div style={{
                  height: 26, borderRadius: 4, border: s.isToday ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: s.share == null
                    ? (s.scheduled ? "repeating-linear-gradient(45deg, var(--bg-tertiary), var(--bg-tertiary) 3px, transparent 3px, transparent 6px)" : "transparent")
                    : `rgba(62, 207, 142, ${0.15 + 0.85 * s.share})`,
                }} />
              </Tooltip>
            ))}
          </div>
          <Text size="xs" c="dimmed" mb={4}>Next 7 days</Text>
          <Stack gap={4}>
            {c.upcoming.map((u) => (
              <Group key={u.date} gap="xs" wrap="nowrap" align="flex-start">
                <Text size="xs" w={70} c="dimmed">{fmtDay(u.date, false)}</Text>
                {u.activities.length ? (
                  <Group gap={4} wrap="wrap">
                    {u.activities.map((a) => (
                      <Tooltip key={a.kind} label={a.names.join(", ") || a.label} disabled={!a.names.length}>
                        <Badge size="sm" variant="light" style={{ textTransform: "none" }}>{a.label}{a.kind !== "lift" && a.names[0] ? ` · ${a.names[0]}` : ""}</Badge>
                      </Tooltip>
                    ))}
                  </Group>
                ) : <Text size="xs" c="dimmed">Nothing scheduled</Text>}
              </Group>
            ))}
          </Stack>
        </>
      )}
      {!c && !d.calendarError && <Text size="sm" c="dimmed">{d.client.isActive ? "No app account linked." : "Not on an active program."}</Text>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

function Assessments({ d, save, toggle }: { d: HubDetail; save: Save; toggle: (kind: string, done: boolean) => Promise<void> }) {
  const others = d.assessments.filter((a) => a.last && !d.checklist.some((c) => c.kind === a.kind || (c.kind === "pitching_3d" && a.kind === "hitting_3d")));
  return (
    <Card title="Assessments this program" sub={d.client.periodStart ? `since ${fmtDay(d.client.periodStart)} (counts sessions from 30 days before)` : undefined}
      right={<DateField label="Next due" value={d.client.nextAssessmentDue} onSave={(v) => void save({ nextAssessmentDue: v })} w={140} />}>
      {!d.client.athleteUuid && <Alert color="yellow" mb="sm">Not linked to an athlete in the database yet, so lab sessions can&apos;t tick these. You can still check them by hand.</Alert>}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        {d.checklist.map((c) => (
          <div key={c.kind} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: c.done ? "rgba(62, 207, 142, 0.08)" : undefined }}>
            <Checkbox
              label={<Text fw={600} size="sm">{c.label}</Text>}
              checked={c.done}
              color={c.auto ? "green" : "blue"}
              // A session in the database always counts, so it can't be unchecked here.
              onChange={(e) => { if (!c.auto) void toggle(c.kind, e.currentTarget.checked); }}
              styles={c.auto ? { input: { cursor: "default" }, label: { cursor: "default" } } : undefined}
            />
            <Text size="xs" c="dimmed" mt={4}>
              {c.auto ? `In the database · ${fmtDay(c.auto)}`
                : c.manual ? `Checked by ${c.manualBy ?? "a coach"} · ${fmtDay(c.manual, false)}`
                : c.last ? `Not yet · last ${fmtDay(c.last)}` : "Not yet · never done"}
            </Text>
            {c.auto && c.manual && <Text size="10px" c="dimmed">also checked by {c.manualBy ?? "a coach"}</Text>}
          </div>
        ))}
      </SimpleGrid>
      {others.length > 0 && (
        <Text size="xs" c="dimmed" mt="sm">
          Also on file: {others.map((a) => `${a.label} ${fmtDay(a.last)}`).join(" · ")}
        </Text>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Link to a warehouse athlete (when the sync couldn't tell)
// ---------------------------------------------------------------------------

function LinkAthlete({ d, onLinked, onError, onCancel }: { d: HubDetail; onLinked: () => void; onError: (m: string) => void; onCancel?: () => void }) {
  const [q, setQ] = useState(d.client.name);
  const { data } = useSWR<{ athletes: Array<{ athleteUuid: string; name: string; email: string | null; linkedTo: string | null }> }>(
    q.trim().length >= 2 ? `${HUB}/athletes?q=${encodeURIComponent(q.trim())}` : null, hubGet, hubSwr);
  const link = async (body: Record<string, unknown>) => {
    try { await hubSend("POST", `${HUB}/clients/${d.client.id}/link`, body); onLinked(); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  const candidates = d.client.linkCandidates ?? [];
  const changing = !!d.client.athleteUuid;
  return (
    <Alert color="orange" title={changing ? "Link this client to a different athlete" : "Which athlete is this?"} withCloseButton={!!onCancel} onClose={onCancel}>
      <Text size="sm" mb="xs">
        {changing
          ? "Use this when the sync picked the wrong athlete, or made a new one for someone who was already in the database. Their lab data, Program tabs and this client page follow the athlete you pick."
          : "The sync found athletes in the database with a similar name, so it didn't create a new one. Link the right athlete, or create a new one if none of them is this client."}
      </Text>
      <Group gap="xs" mb="xs" wrap="wrap">
        {candidates.map((c) => (
          <Button key={c.athleteUuid} size="xs" variant="light" onClick={() => void link({ athleteUuid: c.athleteUuid })}>{c.name} ({c.score})</Button>
        ))}
        {!changing && <Button size="xs" variant="outline" color="gray" onClick={() => void link({ create: true })}>None of these: create new athlete</Button>}
      </Group>
      <TextInput size="xs" placeholder="Search athletes…" value={q} onChange={(e) => setQ(e.currentTarget.value)} w={260} />
      <Stack gap={2} mt={4}>
        {data?.athletes.map((a) => (
          <Group key={a.athleteUuid} gap="xs">
            <Anchor size="xs" component="button" disabled={!!a.linkedTo || a.athleteUuid === d.client.athleteUuid} onClick={() => void link({ athleteUuid: a.athleteUuid })}>{a.name}</Anchor>
            <Text size="xs" c="dimmed">{a.email ?? ""}{a.linkedTo ? ` · already the hub client "${a.linkedTo}"` : ""}</Text>
          </Group>
        ))}
      </Stack>
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** "phase: Onboarding → Velo block, periodId: 12" */
function describeDetail(detail: Record<string, unknown>): string {
  return Object.entries(detail)
    .map(([k, v]) => {
      if (v && typeof v === "object" && "to" in v) {
        const change = v as { from?: unknown; to?: unknown };
        return `${k}: ${String(change.from ?? "—")} → ${String(change.to ?? "—")}`;
      }
      return `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`;
    })
    .join(", ");
}

const UPDATE_LABEL: Record<string, string> = { updPlyos: "Plyos", updLifts: "Lifts", updDelivery: "Delivery" };

export function ClientProfile({ clientId, embedded = false }: { clientId: string; embedded?: boolean }) {
  const key = detailKey(clientId);
  const { data: d, error, isLoading, mutate } = useSWR<HubDetail>(key, hubGet, hubSwr);
  const [err, setErr] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [noteGoals, setNoteGoals] = useState("");
  const [noteDate, setNoteDate] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [noteLink, setNoteLink] = useState("");
  const [relinking, setRelinking] = useState(false);

  const fail = (e: unknown) => setErr(e instanceof Error ? e.message : String(e));
  const refresh = () => void mutate();
  const save: Save = async (patch) => {
    try {
      setErr(null);
      await hubSend("PATCH", key, patch);
      await mutate();
    } catch (e) { fail(e); }
  };

  if (isLoading) return <Loader size="sm" />;
  if (error || !d) {
    const notInstalled = error instanceof HubError && error.code === "HubNotInstalledError";
    return <Alert color={notInstalled ? "yellow" : "red"}>{error?.message ?? "Client not found"}</Alert>;
  }
  const c = d.client;
  const statusValue = c.statusOverride ?? "auto";

  return (
    <Stack gap="md" maw={embedded ? undefined : 1280} mx={embedded ? undefined : "auto"}>
      {/* Header */}
      <div className="card" style={{ marginBottom: 0 }}>
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
          <div>
            {!embedded && <Anchor component={Link} href="/coach/clients" size="xs">← Client Hub</Anchor>}
            <Group gap="sm" align="center">
              {embedded ? <Title order={3}>Program management</Title> : <Title order={2}>{c.name}</Title>}
              <Badge variant="light" color={STATUS_COLOR[c.status]} size="lg">{STATUS_LABEL[c.status]}</Badge>
              {c.programType && <Badge variant="outline">{PROGRAM_TYPE_LABEL[c.programType]}</Badge>}
            </Group>
            <Text size="sm" c="dimmed" mt={4}>
              {[c.programName, c.periodStart && `${fmtDay(c.periodStart)} → ${c.periodEnd ? fmtDay(c.periodEnd) : "open"}`,
                c.periodDaysLeft != null && c.isActive && (c.periodDaysLeft >= 0 ? `${c.periodDaysLeft} days left` : `ended ${-c.periodDaysLeft} days ago`),
                c.periodCount > 1 && `client since ${fmtDay(c.clientSince)} · ${c.periodCount} programs`].filter(Boolean).join(" · ") || "No program dates yet"}
            </Text>
            <Group gap="md" mt={6}>
              {!embedded && c.athleteUuid && <Anchor component={Link} href={`/coach/athletes/${c.athleteUuid}`} size="sm">Athlete data →</Anchor>}
              {embedded && <Anchor component={Link} href={`/coach/clients/${c.id}`} size="sm">Open in Client Hub →</Anchor>}
              {c.athleteUuid && <Anchor size="xs" component="button" c="dimmed" onClick={() => setRelinking((x) => !x)}>Change linked athlete</Anchor>}
              {c.email && <Text size="xs" c="dimmed">{c.email}</Text>}
            </Group>
          </div>
          <Stack gap={6} align="flex-end">
            <Select
              size="xs" label="Status" w={250} allowDeselect={false} value={statusValue}
              data={[
                { value: "auto", label: `Automatic · ${STATUS_LABEL[c.autoStatus]} (program dates)` },
                { value: "active", label: "Active (set by coach)" },
                { value: "paused", label: "Paused (set by coach)" },
                { value: "expired", label: "Expired (set by coach)" },
              ]}
              onChange={(v) => void save({ statusOverride: v === "auto" ? null : v })}
            />
            <Group gap="md">
              <Switch size="xs" label="My client" checked={!!d.row.isMine} onChange={(e) => void save({ isMine: e.currentTarget.checked })} />
              <Switch size="xs" label="Needs review" checked={c.needsReview} onChange={(e) => void save({ needsReview: e.currentTarget.checked })} />
            </Group>
          </Stack>
        </Group>
      </div>

      {err && <Alert color="red" withCloseButton onClose={() => setErr(null)}>{err}</Alert>}
      {c.linkReview && !c.athleteUuid && <LinkAthlete d={d} onLinked={refresh} onError={setErr} />}
      {relinking && c.athleteUuid && <LinkAthlete d={d} onLinked={() => { setRelinking(false); refresh(); }} onError={setErr} onCancel={() => setRelinking(false)} />}

      <Card title="Program periods" sub="Dates come from the 8ctane app. Changing one here keeps the app's date alongside and never edits the app.">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", margin: 0 }}>
            <thead><tr><th>Program</th><th>Start</th><th>End</th><th>Span</th><th /></tr></thead>
            <tbody>
              {d.periods.map((p) => <PeriodRow key={p.id} p={p} clientId={c.id} onChanged={refresh} onError={setErr} />)}
              {!d.periods.length && <tr><td colSpan={5}><Text size="sm" c="dimmed">No programs.</Text></td></tr>}
            </tbody>
          </table>
        </div>
        <AddPeriod clientId={c.id} onDone={refresh} onError={setErr} />
      </Card>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Stack gap="md">
          <AppCard d={d} />
          <Card title="Coach log">
            <Stack gap="xs">
              <Textarea size="xs" placeholder="What happened, what's next…" autosize minRows={2} value={noteBody} onChange={(e) => setNoteBody(e.currentTarget.value)} />
              <Group gap="xs" align="flex-end">
                <TextInput size="xs" placeholder="Goals (optional)" value={noteGoals} onChange={(e) => setNoteGoals(e.currentTarget.value)} style={{ flex: 1 }} />
                <TextInput size="xs" placeholder="Link (optional)" value={noteLink} onChange={(e) => setNoteLink(e.currentTarget.value)} w={150} />
                <TextInput size="xs" type="date" value={noteDate || d.today} onChange={(e) => setNoteDate(e.currentTarget.value)} />
                <Button size="xs" disabled={!noteBody.trim()} onClick={async () => {
                  try {
                    await hubSend("POST", `${key}/notes`, { date: noteDate || d.today, body: noteBody.trim(), ...(noteGoals.trim() ? { goals: noteGoals.trim() } : {}), ...(noteLink.trim() ? { link: noteLink.trim() } : {}) });
                    setNoteBody(""); setNoteGoals(""); setNoteLink(""); setNoteDate(""); refresh();
                  } catch (e) { fail(e); }
                }}>Add note</Button>
              </Group>
              {d.notes.map((n) => (
                <div key={n.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
                  <Group justify="space-between" gap="xs">
                    <Text size="xs" c="dimmed">{fmtDay(n.date)}{n.authorName ? ` · ${n.authorName}` : ""}</Text>
                    <Anchor size="xs" component="button" c="red" onClick={async () => { try { await hubSend("DELETE", `${key}/notes/${n.id}`); refresh(); } catch (e) { fail(e); } }}>delete</Anchor>
                  </Group>
                  <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{n.body}</Text>
                  {n.goals && <Text size="xs" c="dimmed">Goals: {n.goals}</Text>}
                  {n.link && <Anchor size="xs" href={n.link} target="_blank" rel="noopener noreferrer">{n.link}</Anchor>}
                </div>
              ))}
              {!d.notes.length && <Text size="xs" c="dimmed">No notes yet.</Text>}
            </Stack>
          </Card>
        </Stack>

        <Stack gap="md">
          <Assessments d={d} save={save}
            toggle={async (kind, done) => { try { await hubSend("PUT", `${key}/assessments`, { kind, done }); refresh(); } catch (e) { fail(e); } }} />

          <Card title="Onboarding" sub="Assessment = mobility or athletic screen checked above, 3D = 3D checked above">
            <Group gap="lg">
              <Checkbox label="Assessment" checked={d.onboarding.assessment} color="green" onChange={() => undefined} styles={{ input: { cursor: "default" } }} />
              <Checkbox label="3D" checked={d.onboarding.threeD} color="green" onChange={() => undefined} styles={{ input: { cursor: "default" } }} />
              <Checkbox label="Review" checked={d.onboarding.review} onChange={(e) => void save({ onbReview: e.currentTarget.checked })} />
            </Group>
          </Card>

          <Card title="Programming updates" sub="Moves forward by itself when new sessions show up in the app">
            <Group gap="md" align="flex-end" wrap="wrap">
              {UPDATE_FIELDS.map((f) => {
                const src = c[`${f}Source` as const];
                return (
                  <Group key={f} gap={4} align="flex-end" wrap="nowrap">
                    <DateField label={UPDATE_LABEL[f]} value={c[f]} hint={src ? (src === "app" ? "from app" : "set by coach") : "not set"} onSave={(v) => void save({ [f]: v })} w={140} />
                    <Button size="compact-xs" variant="subtle" mb={6} onClick={() => void save({ [f]: d.today })}>Today</Button>
                  </Group>
                );
              })}
            </Group>
          </Card>

          <Card title="Contract" sub={c.contractStart && c.contractStart <= d.today ? `started ${Math.round((Date.parse(d.today) - Date.parse(c.contractStart)) / 86_400_000)} days ago` : undefined}>
            <Group gap="sm" align="flex-end" wrap="wrap">
              <TextField label="Duration" value={c.contractDuration} placeholder="e.g. 6 months" onSave={(v) => void save({ contractDuration: v })} w={120} />
              <DateField label="Start" value={c.contractStart} onSave={(v) => void save({ contractStart: v })} w={140} />
              <DateField label="End" value={c.contractEnd} onSave={(v) => void save({ contractEnd: v })} w={140} />
              <Select size="xs" label="Status" w={120} allowDeselect={false} value={c.contractStatus}
                data={[{ value: "SIGNED", label: "Signed" }, { value: "SENT", label: "Sent" }, { value: "NOT_SENT", label: "Not sent" }]}
                onChange={(v) => v && void save({ contractStatus: v })} />
            </Group>
          </Card>

          <Card title="Details">
            <SimpleGrid cols={2} spacing="xs">
              <Select size="xs" label="Phase" value={c.phase} clearable searchable
                data={[...new Set([...PHASES, ...(c.phase ? [c.phase] : [])])]} onChange={(v) => void save({ phase: v })} />
              <TextField label="Coach" value={c.coachName} placeholder={c.programCoaches.join(", ") || undefined} onSave={(v) => void save({ coachName: v })} />
              <TextField label="Schedule" value={c.scheduleNote} placeholder="e.g. Lifts M/W/F" onSave={(v) => void save({ scheduleNote: v })} />
              <DateField label="Last contacted" value={c.lastContacted} onSave={(v) => void save({ lastContacted: v })} />
              <TextField label="Position" value={c.position} onSave={(v) => void save({ position: v })} />
              <TextField label="Team" value={c.team} onSave={(v) => void save({ team: v })} />
              <Select size="xs" label="Throws" value={c.throws} clearable data={[{ value: "R", label: "Right" }, { value: "L", label: "Left" }]}
                onChange={(v) => void save({ throws: v })} />
              <TextField label="Name" value={c.name} onSave={(v) => v && void save({ name: v })} />
            </SimpleGrid>
          </Card>

          <Card title="History" right={<Button size="compact-xs" variant="subtle" onClick={() => setShowHistory((x) => !x)}>{showHistory ? "Hide" : `Show (${d.events.length})`}</Button>}>
            {showHistory ? (
              <Stack gap={2}>
                {d.events.map((e) => (
                  <Text key={e.id} size="xs" c="dimmed">
                    {new Date(e.at).toLocaleString()} · {e.actorName ?? "—"} · {e.action}
                    {e.detail ? ` · ${describeDetail(e.detail)}` : ""}
                  </Text>
                ))}
                {!d.events.length && <Text size="xs" c="dimmed">No changes yet.</Text>}
              </Stack>
            ) : <Text size="xs" c="dimmed">Every edit here is logged with who made it.</Text>}
          </Card>
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}

