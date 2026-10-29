"use client";

/**
 * Client Hub: every athlete on an 8ctane program (active programmers by default, expired
 * and paused one click away). Rows open the client page (/coach/clients/:id), the same
 * page an active programmer's "Program Management" tab shows.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Alert, Badge, Button, Chip, Code, Group, Loader, SegmentedControl, Stack, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { PROGRAM_TYPES, PROGRAM_TYPE_LABEL } from "@/lib/client-hub/constants";
import type { ClientRow, Focus } from "@/lib/client-hub/flags";
import { fmtDay, HUB, HubError, hubGet, hubSend, hubSwr, listKey, STATUS_COLOR, STATUS_LABEL, TONE_COLOR, type HubList, type SyncResult } from "./api";

const FOCUS_LABEL: Record<Focus, string> = {
  program: "Programming runs out ≤ 7d",
  ending: "Program ends ≤ 14d",
  quiet: "Nothing checked off (7d)",
  updates: "Updates due",
  onboarding: "Onboarding open",
  assessment: "Assessment due",
  contract: "Contract ending",
  review: "To review",
};

const STALE_MS = 6 * 3_600_000;
/** Assessment checklist: Mobility, Proteus, 3D, Athletic screen. Green = in the database, blue = checked by a coach. */
const SHORT: Record<string, string> = { mobility: "Mob", proteus: "Pro", pitching_3d: "3D", athletic_screen: "AS" };

function Stat({ label, value, active, tone, onClick }: { label: string; value: number; active?: boolean; tone?: "warn" | "bad"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card"
      style={{
        cursor: "pointer", textAlign: "left", padding: "0.7rem 0.9rem", minWidth: 150, marginBottom: 0,
        borderColor: active ? "var(--accent)" : undefined, background: active ? "var(--accent-muted)" : undefined,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color: value && tone ? TONE_COLOR[tone] : undefined }}>{value}</div>
    </button>
  );
}

function Toned({ tone, children, title }: { tone: keyof typeof TONE_COLOR; children: React.ReactNode; title?: string }) {
  return <span title={title} style={{ color: TONE_COLOR[tone], fontWeight: tone === "bad" || tone === "warn" ? 600 : undefined }}>{children}</span>;
}

/** One fixed-width check box in the onboarding & assessments column, so they line up row to row. */
function Pip({ label, state, tip }: { label: string; state: "db" | "coach" | "open"; tip: string }) {
  const bg = state === "db" ? "var(--accent-green)" : state === "coach" ? "var(--accent)" : "transparent";
  return (
    <Tooltip label={tip}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 20, borderRadius: 4,
        fontSize: 11, fontWeight: 600, background: bg, color: state === "open" ? "var(--text-muted)" : "#0d1117",
        border: state === "open" ? "1px dashed var(--border)" : "1px solid transparent",
      }}>{label}</span>
    </Tooltip>
  );
}

type SortKey = "name" | "status" | "program" | "coverage" | "week" | "update" | "phase" | "checks" | "contract";
const STATUS_ORDER: Record<string, number> = { active: 0, paused: 1, expired: 2 };

/** Value each column sorts by. null always sorts last, in either direction. */
const SORT_VALUE: Record<SortKey, (r: ClientRow) => string | number | null> = {
  name: (r) => r.name.toLowerCase(),
  status: (r) => STATUS_ORDER[r.status] ?? 9,
  program: (r) => r.periodEnd,
  coverage: (r) => r.coverage.lastScheduled ?? (r.coverage.days === -1 ? "0000-00-00" : null),
  week: (r) => (r.week && r.week.trackable ? r.week.done / r.week.trackable : null),
  update: (r) => r.oldestUpdateDays,
  phase: (r) => r.phase?.toLowerCase() ?? null,
  checks: (r) => r.checklist.filter((c) => c.done).length + (r.reviewDone ? 1 : 0),
  contract: (r) => r.contractEnd,
};

function sortRows(rows: ClientRow[], key: SortKey | null, dir: "asc" | "desc"): ClientRow[] {
  if (!key) return rows;
  const get = SORT_VALUE[key];
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x == null && y == null) return a.name.localeCompare(b.name);
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return (dir === "asc" ? c : -c) || a.name.localeCompare(b.name);
  });
}

function Th({ k, label, sort, dir, onSort, style }: { k: SortKey; label: string; sort: SortKey | null; dir: "asc" | "desc"; onSort: (k: SortKey) => void; style?: React.CSSProperties }) {
  const on = sort === k;
  return (
    <th style={{ cursor: "pointer", userSelect: "none", verticalAlign: "bottom", ...style }} onClick={() => onSort(k)} title="Sort (click again to reverse)">
      {label}&nbsp;<span style={{ opacity: on ? 1 : 0.3, fontSize: 10, whiteSpace: "nowrap" }}>{on ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
    </th>
  );
}

function Row({ r, onOpen }: { r: ClientRow; onOpen: () => void }) {
  const period = r.periodStart || r.periodEnd ? `${fmtDay(r.periodStart, false)} → ${r.periodEnd ? fmtDay(r.periodEnd) : "open"}` : "—";
  return (
    <tr onClick={onOpen} style={{ cursor: "pointer" }}>
      <td style={{ minWidth: 210 }}>
        <Group gap={6} wrap="nowrap">
          <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{r.name}</span>
          {r.isMine && <Badge size="xs" style={{ flexShrink: 0, overflow: "visible" }} variant="light">Mine</Badge>}
          {r.needsReview && <Badge size="xs" style={{ flexShrink: 0, overflow: "visible" }} color="orange" variant="light">Review</Badge>}
          {r.linkReview && <Tooltip label="Couldn't tell which warehouse athlete this is. Open to link."><Badge size="xs" style={{ flexShrink: 0, overflow: "visible" }} color="red" variant="light">Link athlete</Badge></Tooltip>}
        </Group>
        <Text size="xs" c="dimmed">{[r.programName, r.programTypeLabel, r.info].filter(Boolean).join(" · ") || "—"}</Text>
      </td>
      <td style={{ minWidth: 96 }}>
        <Badge size="sm" variant="light" color={STATUS_COLOR[r.status]} style={{ overflow: "visible" }}>{STATUS_LABEL[r.status]}</Badge>
        {r.statusOverride && <Text size="10px" c="dimmed">set by coach</Text>}
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        <div>{period}</div>
        <Text size="xs" c="dimmed">
          {r.status === "active" && r.periodDaysLeft != null ? (
            <Toned tone={r.periodTone}>{r.periodDaysLeft < 0 ? `ended ${-r.periodDaysLeft}d ago` : `${r.periodDaysLeft}d left`}</Toned>
          ) : r.periodCount > 1 ? `${r.periodCount} programs since ${fmtDay(r.clientSince)}` : null}
        </Text>
      </td>
      <td style={{ whiteSpace: "nowrap" }}><Toned tone={r.coverage.tone}>{r.coverage.label}</Toned></td>
      <td style={{ whiteSpace: "nowrap" }}>
        {r.week ? (
          r.week.trackable === 0 ? <Text size="sm" c="dimmed">Nothing to tick</Text> : (
            <Toned tone={r.weekTone}>{r.week.done}/{r.week.trackable} sets</Toned>
          )
        ) : <Text size="sm" c="dimmed">—</Text>}
        {r.week?.lastTick && <Text size="xs" c="dimmed">last {fmtDay(r.week.lastTick, false)}</Text>}
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        {r.status === "active" ? <Toned tone={r.oldestUpdateTone}>{r.oldestUpdateDays == null ? "Not set" : `${r.oldestUpdateDays}d`}</Toned> : <Text size="sm" c="dimmed">—</Text>}
      </td>
      <td style={{ whiteSpace: "nowrap" }}><Text size="sm">{r.phase ?? "—"}</Text></td>
      <td style={{ whiteSpace: "nowrap" }}>
        <Group gap={4} wrap="nowrap">
          {r.checklist.map((a) => (
            <Pip key={a.kind} label={SHORT[a.kind] ?? a.label} state={a.done ? (a.auto ? "db" : "coach") : "open"}
              tip={a.done ? (a.auto ? `${a.label}: in the database ${fmtDay(a.auto)}` : `${a.label}: checked by ${a.manualBy ?? "a coach"} ${fmtDay(a.manual)}`)
                : `${a.label}: not done this program${a.last ? ` (last ${fmtDay(a.last)})` : ""}`} />
          ))}
          <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 2px" }} />
          <Pip label="Rev" state={r.reviewDone ? "coach" : "open"} tip={r.reviewDone ? "Onboarding review done" : "Onboarding review not done"} />
        </Group>
        <Text size="xs" mt={2} style={{ color: r.assessmentDue ? TONE_COLOR.warn : "var(--text-muted)" }}>
          {r.nextAssessmentDue ? `next due ${fmtDay(r.nextAssessmentDue, false)}`
            : r.lastAssessment ? `last assessed ${fmtDay(r.lastAssessment, false)}` : "never assessed"}
        </Text>
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        <Toned tone={r.contractTone}>{fmtDay(r.contractEnd)}</Toned>
      </td>
    </tr>
  );
}

function ClientHubInner() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const status = sp.get("status") ?? "active";
  const scope = sp.get("scope") ?? "all";
  const types = (sp.get("types") ?? "").split(",").filter(Boolean);
  const focus = (sp.get("focus") as Focus | null) ?? null;
  const [q, setQ] = useState(sp.get("q") ?? "");
  const sortParam = sp.get("sort");
  const sortKey: SortKey | null = sortParam && sortParam in SORT_VALUE ? (sortParam as SortKey) : null;
  const sortDir: "asc" | "desc" = sp.get("dir") === "desc" ? "desc" : "asc";

  const params = new URLSearchParams({ status, scope, types: types.join(","), q: sp.get("q") ?? "" });
  if (focus) params.set("focus", focus);
  const { data, error, isLoading, mutate } = useSWR<HubList>(listKey(params), hubGet, { ...hubSwr, keepPreviousData: true });

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const autoTried = useRef(false);

  const setParam = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.replace(`${pathname}?${p}`, { scroll: false });
  };

  // Debounced search into the URL.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get("q") ?? "") !== q) setParam({ q: q || null });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function sync(force: boolean) {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await hubSend<SyncResult>("POST", `${HUB}/sync`, { force });
      if (r.skipped === "running") setSyncMsg({ ok: true, text: "A sync is already running. Refreshing when it's done." });
      else if (!r.skipped) {
        const bits = [
          `${r.clients} clients`,
          r.newClients && `${r.newClients} new`,
          r.newPeriods && `${r.newPeriods} new programs`,
          r.athletesCreated && `${r.athletesCreated} athletes added to the database`,
          r.needLinkReview && `${r.needLinkReview} to link by hand`,
          r.reactivated && `${r.reactivated} back on a program`,
          !r.calendarAvailable && "check-offs unavailable (snapshot has no workout tables)",
        ].filter(Boolean);
        setSyncMsg({ ok: true, text: `Synced: ${bits.join(" · ")}` });
      }
      await mutate();
    } catch (e) {
      setSyncMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSyncing(false);
    }
  }

  // First load: sync if the hub has never synced, the app snapshot is newer, or the last sync is more than 6 h old.
  useEffect(() => {
    if (!data || autoTried.current) return;
    autoTried.current = true;
    const snapshotNewer = !!data.snapshotAt && !!data.syncedAt && Date.parse(data.snapshotAt) > Date.parse(data.syncedAt);
    if (!data.syncedAt || snapshotNewer || Date.now() - Date.parse(data.syncedAt) > STALE_MS) void sync(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Click a header: ascending (A→Z, earliest first); click it again: reversed.
  const sortProps = {
    sort: sortKey,
    dir: sortDir,
    onSort: (k: SortKey) => setParam({ sort: k, dir: sortKey === k && sortDir === "asc" ? "desc" : "asc" }),
  };
  const rows = data ? sortRows(data.rows, sortKey, sortDir) : [];

  const notInstalled = error instanceof HubError && error.code === "HubNotInstalledError";
  const s = data?.stats;
  const goFocus = (f: Focus | null, st = "active") => setParam({ focus: f === focus ? null : f, status: st });

  return (
    <Stack gap="md" maw={1920} mx="auto">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={2}>Client Hub</Title>
          <Text size="sm" c="dimmed">
            Everyone on an 8ctane program. Dates come from the app; anything you change here stays in the hub.
            {data && ` Last synced ${data.syncedAt ? new Date(data.syncedAt).toLocaleString() : "never"}${data.snapshotAt ? ` · app snapshot ${new Date(data.snapshotAt).toLocaleString()}` : ""}.`}
          </Text>
        </div>
        <Button variant="light" size="xs" loading={syncing} onClick={() => void sync(true)} disabled={notInstalled}>
          Sync from app
        </Button>
      </Group>

      {notInstalled && (
        <Alert color="yellow" title="Client Hub tables not set up yet">
          Run this once against the warehouse, then reload: <Code>npx prisma db execute --file uais/sql/create_coach_client_hub.sql --schema prisma/schema.prisma</Code>
        </Alert>
      )}
      {error && !notInstalled && <Alert color="red">{error.message}</Alert>}
      {syncMsg && <Alert color={syncMsg.ok ? "blue" : "red"} withCloseButton onClose={() => setSyncMsg(null)}>{syncMsg.text}</Alert>}

      {s && (
        <Group gap="sm" wrap="wrap">
          <Stat label="Active clients" value={s.active} active={status === "active" && !focus} onClick={() => setParam({ status: "active", focus: null })} />
          <Stat label="Programming ≤ 7d" value={s.programmingEnds7} tone="bad" active={focus === "program"} onClick={() => goFocus("program")} />
          <Stat label="Program ends ≤ 14d" value={s.periodsEnding} tone="warn" active={focus === "ending"} onClick={() => goFocus("ending")} />
          <Stat label="Onboarding open" value={s.onboardingOpen} tone="warn" active={focus === "onboarding"} onClick={() => goFocus("onboarding")} />
          <Stat label="Assessment due" value={s.assessmentDue} tone="warn" active={focus === "assessment"} onClick={() => goFocus("assessment")} />
          <Stat label="To review" value={s.toReview} tone="warn" active={focus === "review"} onClick={() => goFocus("review", "all")} />
          <Stat label="Paused" value={s.paused} active={status === "paused" && !focus} onClick={() => setParam({ status: "paused", focus: null })} />
          <Stat label="Expired" value={s.expired} active={status === "expired" && !focus} onClick={() => setParam({ status: "expired", focus: null })} />
        </Group>
      )}

      <Group gap="sm" wrap="wrap">
        <SegmentedControl size="xs" value={status} onChange={(v) => setParam({ status: v })}
          data={[{ value: "active", label: "Active programmers" }, { value: "paused", label: "Paused" }, { value: "expired", label: "Expired programmers" }, { value: "all", label: "All" }]} />
        <SegmentedControl size="xs" value={scope} onChange={(v) => setParam({ scope: v === "all" ? null : v })}
          data={[{ value: "all", label: "All clients" }, { value: "mine", label: "My clients" }]} />
        <Chip.Group multiple value={types} onChange={(v) => setParam({ types: v.join(",") || null })}>
          <Group gap={4}>
            {PROGRAM_TYPES.map((t) => <Chip key={t} value={t} size="xs" variant="outline">{PROGRAM_TYPE_LABEL[t]}</Chip>)}
          </Group>
        </Chip.Group>
        <TextInput size="xs" placeholder="Search name, team, coach, phase, program…" value={q} onChange={(e) => setQ(e.currentTarget.value)} w={280} />
      </Group>
      <Group gap={4} wrap="wrap">
        {(Object.keys(FOCUS_LABEL) as Focus[]).map((f) => (
          <Chip key={f} size="xs" checked={focus === f} onChange={() => setParam({ focus: focus === f ? null : f })}>{FOCUS_LABEL[f]}</Chip>
        ))}
      </Group>

      {isLoading && !data ? <Loader size="sm" /> : data && (
        <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 0 }}>
          <table style={{ width: "100%", margin: 0 }}>
            <thead>
              <tr>
                <Th k="name" label="Client" {...sortProps} />
                <Th k="status" label="Status" {...sortProps} />
                <Th k="program" label="Program" {...sortProps} />
                <Th k="coverage" label="Programmed through" {...sortProps} />
                <Th k="week" label="Checked off (7d)" {...sortProps} />
                <Th k="update" label="Oldest update" {...sortProps} />
                <Th k="phase" label="Phase" {...sortProps} />
                <Th k="checks" label="Assessments · onboarding" {...sortProps} style={{ minWidth: 200 }} />
                <Th k="contract" label="Contract ends" {...sortProps} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <Row key={r.id} r={r} onOpen={() => router.push(`/coach/clients/${r.id}`)} />)}
              {!data.rows.length && (
                <tr><td colSpan={9}><Text size="sm" c="dimmed" ta="center" py="md">
                  {data.totalClients ? "No clients match these filters." : syncing ? "Syncing from the app…" : "No clients yet. Sync from the app to load everyone on a program."}
                </Text></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <Group justify="space-between" gap="xs">
          <Group gap="md">
            <Text size="xs" c="dimmed">{data.rows.length} shown · {data.totalClients} clients in the hub</Text>
            {sortKey && <Text size="xs" c="blue" style={{ cursor: "pointer" }} onClick={() => setParam({ sort: null, dir: null })}>Reset sort</Text>}
          </Group>
          <Group gap="sm">
            <Group gap={4}><Pip label="" state="db" tip="" /><Text size="xs" c="dimmed">in the database</Text></Group>
            <Group gap={4}><Pip label="" state="coach" tip="" /><Text size="xs" c="dimmed">checked by a coach</Text></Group>
            <Group gap={4}><Pip label="" state="open" tip="" /><Text size="xs" c="dimmed">not done</Text></Group>
            <Text size="xs" c="dimmed">Mob = mobility · Pro = Proteus · AS = athletic screen · Rev = onboarding review</Text>
          </Group>
        </Group>
      )}
    </Stack>
  );
}

export function ClientHubView() {
  return (
    <Suspense fallback={<Loader size="sm" />}>
      <ClientHubInner />
    </Suspense>
  );
}
