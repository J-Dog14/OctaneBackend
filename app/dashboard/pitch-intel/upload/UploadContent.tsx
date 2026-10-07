"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import type { UploadPreview, ScreenshotPreview } from "@/lib/pitch-intel/uploads/handle";
import type { TrackmanPreview, TrackmanPitchPreview } from "@/lib/pitch-intel/trackman/import";
import type { SavantPreview } from "@/lib/pitch-intel/uploads/savant";
import type { ReportPitchRow, ReportSource } from "@/lib/pitch-intel/reports/vision";
import { PITCH_CODES, PITCH_COLORS, PITCH_LABELS, type PitchCode } from "@/lib/pitch-intel/pitch-types";
import { AthletePicker } from "./AthletePicker";

const LEVELS = ["Youth (14U)", "High School", "College", "Indy / Summer Ball", "MiLB", "MLB"];
const PITCH_OPTIONS = PITCH_CODES.map((c) => ({ value: c, label: `${c} · ${PITCH_LABELS[c]}` }));
const SOURCE_OPTIONS: Array<{ value: ReportSource; label: string }> = [
  { value: "trackman_summary", label: "Trackman summary" },
  { value: "savant", label: "Savant / scouting page" },
  { value: "claw", label: "CLAW" },
  { value: "rapsodo", label: "Rapsodo" },
  { value: "other", label: "Other report" },
];
const ACCEPT = ".csv,.xlsx,.png,.jpg,.jpeg,.webp,.gif,.pdf";

type SavedResult = { kind: string; [k: string]: unknown };

const mean = (xs: Array<number | null>) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const fmt = (v: number | null | undefined, digits = 1) => (v == null ? "—" : v.toFixed(digits));

function PitchBadge({ code }: { code: PitchCode }) {
  return (
    <Badge size="sm" variant="filled" style={{ background: PITCH_COLORS[code] }}>
      {code}
    </Badge>
  );
}

async function postForm(url: string, form: FormData) {
  const res = await fetch(url, { method: "POST", body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function UploadContent() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setError(null);
    setSaved(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const read = useCallback(async (f: File) => {
    setFile(f);
    setPreview(null);
    setSaved(null);
    setError(null);
    setReading(true);
    try {
      const form = new FormData();
      form.append("file", f);
      setPreview((await postForm("/api/dashboard/pitch-intel/upload/parse", form)) as UploadPreview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that file");
    } finally {
      setReading(false);
    }
  }, []);

  // Paste a screenshot straight from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (preview || reading) return;
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      const blob = item?.getAsFile();
      if (!blob) return;
      const ext = blob.type.split("/")[1] || "png";
      void read(new File([blob], `pasted-screenshot.${ext}`, { type: blob.type }));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [preview, reading, read]);

  async function save(payload: unknown) {
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("payload", JSON.stringify(payload));
      form.append("file", file);
      setSaved((await postForm("/api/dashboard/pitch-intel/upload/commit", form)) as SavedResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box p="md">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={2}>Upload pitch data</Title>
            <Text size="sm" c="dimmed">
              Trackman exports (CSV or XLSX), Baseball Savant pitch-by-pitch CSVs, or screenshots of Trackman, Savant, CLAW and Rapsodo reports. Nothing is saved until you review it.
            </Text>
          </div>
          <Button component={Link} href="/dashboard/pitch-intel" variant="subtle">
            Back to Pitch Intelligence
          </Button>
        </Group>

        {!preview && !saved && (
          <Paper
            withBorder
            p="xl"
            radius="md"
            style={{
              borderStyle: "dashed",
              borderWidth: 2,
              borderColor: dragging ? "var(--mantine-color-blue-5)" : undefined,
              background: dragging ? "var(--mantine-color-blue-light)" : undefined,
              cursor: reading ? "wait" : "pointer",
              textAlign: "center",
            }}
            onClick={() => !reading && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f && !reading) void read(f);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) void read(f);
              }}
            />
            {reading ? (
              <Stack align="center" gap="xs">
                <Loader />
                <Text size="sm">Reading {file?.name}…</Text>
                {file && /\.(png|jpe?g|webp|gif|pdf)$/i.test(file.name) && (
                  <Text size="xs" c="dimmed">
                    Screenshots are read by Claude, which takes 10 to 30 seconds.
                  </Text>
                )}
              </Stack>
            ) : (
              <Stack align="center" gap={4}>
                <Text fw={600}>Drop a file here, click to choose one, or paste a screenshot</Text>
                <Text size="xs" c="dimmed">
                  CSV, XLSX, PNG, JPG, WEBP, GIF or PDF · up to 15 MB
                </Text>
              </Stack>
            )}
          </Paper>
        )}

        {error && (
          <Alert color="red" withCloseButton onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {saved ? (
          <SavedPanel result={saved} onAnother={reset} />
        ) : preview ? (
          <Stack gap="md">
            <Group justify="space-between">
              <Group gap="xs">
                <Badge variant="light" size="lg">
                  {preview.kind === "trackman" ? "Trackman" : preview.kind === "savant" ? "Baseball Savant" : "Screenshot"}
                </Badge>
                <Text size="sm" fw={500}>
                  {preview.filename}
                </Text>
              </Group>
              <Button variant="subtle" color="gray" onClick={reset} disabled={saving}>
                Start over
              </Button>
            </Group>
            {preview.warnings.map((w) => (
              <Alert key={w} color="orange" py="xs">
                {w}
              </Alert>
            ))}
            {preview.kind === "trackman" && <TrackmanReview preview={preview} saving={saving} onSave={save} />}
            {preview.kind === "savant" && <SavantReview preview={preview} saving={saving} onSave={save} />}
            {preview.kind === "screenshot" && file && <ScreenshotReview preview={preview} file={file} saving={saving} onSave={save} />}
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// After saving
// ---------------------------------------------------------------------------

function SavedPanel({ result, onAnother }: { result: SavedResult; onAnother: () => void }) {
  let text = "Saved.";
  let athletes: string[] = [];
  let showDashboard = false;
  if (result.kind === "trackman") {
    const r = result as unknown as { saved: number; inserted: number; updated: number; skippedPitchers: string[]; athletes: Array<{ athleteUuid: string }> };
    text = `Saved ${r.saved} Trackman pitches (${r.inserted} new, ${r.updated} updated).${r.skippedPitchers.length ? ` Skipped: ${r.skippedPitchers.join(", ")}.` : ""}`;
    athletes = r.athletes.map((a) => a.athleteUuid);
    showDashboard = true;
  } else if (result.kind === "savant") {
    const r = result as unknown as { status: string; inserted: number; updated: number; athleteUuid?: string; error?: string | null };
    text = `Savant file ${r.status}: ${r.inserted} new pitches, ${r.updated} updated.${r.error ? ` ${r.error}` : ""}`;
    if (r.athleteUuid) athletes = [r.athleteUuid];
    showDashboard = true;
  } else if (result.kind === "screenshot") {
    const r = result as unknown as { rows: number; athleteUuid?: string };
    text = `Saved the report with ${r.rows} pitch type${r.rows === 1 ? "" : "s"}.`;
    if (r.athleteUuid) athletes = [r.athleteUuid];
  }
  return (
    <Alert color="green" title="Saved">
      <Stack gap="sm">
        <Text size="sm">{text}</Text>
        <Group gap="xs">
          {athletes.map((uuid, i) => (
            <Group key={uuid} gap="xs">
              <Button size="xs" component={Link} href={`/dashboard/pitch-intel/sessions?athlete=${uuid}`}>
                Sessions{athletes.length > 1 ? ` (${i + 1})` : ""}
              </Button>
              {showDashboard && (
                <Button size="xs" variant="light" component={Link} href={`/dashboard/pitch-intel/report?athlete=${uuid}`}>
                  Dashboard{athletes.length > 1 ? ` (${i + 1})` : ""}
                </Button>
              )}
            </Group>
          ))}
          <Button size="xs" variant="default" onClick={onAnother}>
            Upload another
          </Button>
        </Group>
      </Stack>
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// Trackman
// ---------------------------------------------------------------------------

interface PitcherChoice {
  athleteUuid: string | null;
  level: string | null;
  include: boolean;
}

function TrackmanReview({ preview, saving, onSave }: { preview: TrackmanPreview; saving: boolean; onSave: (payload: unknown) => void }) {
  const [types, setTypes] = useState<Record<string, PitchCode>>(() => Object.fromEntries(preview.pitches.map((p) => [p.uid, p.type])));
  const [sessionTypes, setSessionTypes] = useState<Record<string, "game" | "bullpen">>(() =>
    Object.fromEntries(preview.sessions.map((s) => [s.key, s.sessionType])),
  );
  const [pitchers, setPitchers] = useState<Record<string, PitcherChoice>>(() =>
    Object.fromEntries(
      preview.pitchers.map((p) => [p.key, { athleteUuid: p.link?.athleteUuid ?? null, level: p.link?.level ?? null, include: true }]),
    ),
  );
  const [openSession, setOpenSession] = useState<string | null>(preview.sessions[0]?.key ?? null);
  const [bulkFrom, setBulkFrom] = useState<string | null>(null);
  const [bulkTo, setBulkTo] = useState<string | null>(null);

  const throwsOf = useMemo(() => new Map(preview.pitchers.map((p) => [p.key, p.throws])), [preview.pitchers]);
  const nameOf = useMemo(() => new Map(preview.pitchers.map((p) => [p.key, p.displayName])), [preview.pitchers]);
  const pitchesBySession = useMemo(() => {
    const m = new Map<string, TrackmanPitchPreview[]>();
    for (const p of preview.pitches) {
      const k = `${p.pitcherKey}|${p.date}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return m;
  }, [preview.pitches]);

  const edited = preview.pitches.filter((p) => types[p.uid] !== p.type).length;
  const problems: string[] = [];
  for (const p of preview.pitchers) {
    const c = pitchers[p.key];
    if (!c.include) continue;
    if (!c.athleteUuid) problems.push(`Pick an athlete for ${p.displayName}, or leave them out.`);
    else if (!p.link && !c.level) problems.push(`Pick a level for ${p.displayName}.`);
  }
  const included = preview.pitchers.filter((p) => pitchers[p.key].include);
  if (!included.length) problems.push("Include at least one pitcher.");

  const setPitcher = (key: string, patch: Partial<PitcherChoice>) => setPitchers((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  function applyBulk(sessionKey: string) {
    if (!bulkFrom || !bulkTo) return;
    const uids = (pitchesBySession.get(sessionKey) ?? []).filter((p) => types[p.uid] === bulkFrom).map((p) => p.uid);
    setTypes((prev) => ({ ...prev, ...Object.fromEntries(uids.map((u) => [u, bulkTo as PitchCode])) }));
  }

  function submit() {
    const pitchTypes = Object.fromEntries(preview.pitches.filter((p) => types[p.uid] !== p.type).map((p) => [p.uid, types[p.uid]]));
    const chosen = Object.fromEntries(
      included.map((p) => [p.key, { athleteUuid: pitchers[p.key].athleteUuid!, level: pitchers[p.key].level }]),
    );
    onSave({ kind: "trackman", choices: { pitchTypes, sessionTypes, pitchers: chosen } });
  }

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Title order={4}>Pitchers</Title>
        <Text size="xs" c="dimmed">
          Each Trackman pitcher is linked to an athlete once. After that, their files are matched automatically.
        </Text>
        {preview.pitchers.map((p) => {
          const c = pitchers[p.key];
          return (
            <Paper key={p.key} withBorder p="sm" radius="md" opacity={c.include ? 1 : 0.55}>
              <Group align="flex-end" gap="md" wrap="wrap">
                <Stack gap={2} miw={220}>
                  <Text fw={600}>{p.displayName}</Text>
                  <Text size="xs" c="dimmed">
                    {p.throws ? `${p.throws}HP` : "Throws unknown"} · {p.pitchCount} pitches · {p.pitcherId ? `Trackman ID ${p.pitcherId}` : "no Trackman ID"}
                  </Text>
                </Stack>
                {p.link ? (
                  <Stack gap={2}>
                    <Text size="xs" c="dimmed">
                      Linked athlete
                    </Text>
                    <Group gap="xs">
                      <Badge color="green" variant="light">
                        {p.link.athleteName}
                      </Badge>
                      <Text size="xs" c="dimmed">
                        {p.link.level ?? "no level"}
                      </Text>
                    </Group>
                  </Stack>
                ) : (
                  <>
                    <AthletePicker
                      suggestions={p.suggestions}
                      value={c.athleteUuid}
                      onChange={(v) => setPitcher(p.key, { athleteUuid: v })}
                      placeholder={`Match ${p.displayName}`}
                    />
                    <Select label="Level" data={LEVELS} value={c.level} onChange={(v) => setPitcher(p.key, { level: v })} w={190} placeholder="Pick level" />
                  </>
                )}
                <Button size="xs" variant="subtle" color={c.include ? "gray" : "blue"} onClick={() => setPitcher(p.key, { include: !c.include })}>
                  {c.include ? "Leave out" : "Include"}
                </Button>
              </Group>
            </Paper>
          );
        })}
      </Stack>

      <Stack gap="xs">
        <Group justify="space-between">
          <Title order={4}>Sessions</Title>
          <Text size="xs" c="dimmed">
            Pitch types were auto-tagged where the file had none. Check them below. {edited ? `${edited} changed.` : ""}
          </Text>
        </Group>
        {preview.sessions.map((s) => {
          if (!pitchers[s.pitcherKey]?.include) return null;
          const list = pitchesBySession.get(s.key) ?? [];
          const isOpen = openSession === s.key;
          const arm = throwsOf.get(s.pitcherKey) === "L" ? -1 : 1;
          const summary = PITCH_CODES.map((code) => {
            const ps = list.filter((p) => types[p.uid] === code);
            if (!ps.length) return null;
            const velos = ps.map((p) => p.velo).filter((v): v is number => v != null);
            return {
              code,
              n: ps.length,
              velo: mean(ps.map((p) => p.velo)),
              max: velos.length ? Math.max(...velos) : null,
              spin: mean(ps.map((p) => p.spin)),
              ivb: mean(ps.map((p) => p.ivb)),
              hbArm: mean(ps.map((p) => (p.hb == null ? null : p.hb * arm))),
              ext: mean(ps.map((p) => p.ext)),
            };
          }).filter((x) => x != null);
          const present = summary.map((r) => r.code);
          return (
            <Paper key={s.key} withBorder p="sm" radius="md">
              <Stack gap="sm">
                <Group justify="space-between" wrap="wrap">
                  <Group gap="sm">
                    <Text fw={600}>{s.date}</Text>
                    <Text size="sm">{nameOf.get(s.pitcherKey)}</Text>
                    <Text size="sm" c="dimmed">
                      {s.pitchCount} pitches
                    </Text>
                    {s.alreadySaved > 0 && (
                      <Badge color="gray" variant="light" size="sm">
                        {s.alreadySaved} already saved
                      </Badge>
                    )}
                  </Group>
                  <Group gap="xs">
                    <SegmentedControl
                      size="xs"
                      value={sessionTypes[s.key]}
                      onChange={(v) => setSessionTypes((prev) => ({ ...prev, [s.key]: v as "game" | "bullpen" }))}
                      data={[
                        { value: "game", label: "Game" },
                        { value: "bullpen", label: "Bullpen" },
                      ]}
                    />
                    <Button size="xs" variant="light" onClick={() => setOpenSession(isOpen ? null : s.key)}>
                      {isOpen ? "Hide pitches" : "Review pitches"}
                    </Button>
                  </Group>
                </Group>

                <ScrollArea>
                  <Table fz="sm" verticalSpacing={4} miw={640}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Type</Table.Th>
                        <Table.Th ta="right">#</Table.Th>
                        <Table.Th ta="right">Velo</Table.Th>
                        <Table.Th ta="right">Max</Table.Th>
                        <Table.Th ta="right">Spin</Table.Th>
                        <Table.Th ta="right">IVB</Table.Th>
                        <Table.Th ta="right">HB (arm +)</Table.Th>
                        <Table.Th ta="right">Ext</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {summary.map((r) => (
                        <Table.Tr key={r.code}>
                          <Table.Td>
                            <Group gap={6}>
                              <PitchBadge code={r.code} />
                              <Text size="sm">{PITCH_LABELS[r.code]}</Text>
                            </Group>
                          </Table.Td>
                          <Table.Td ta="right">{r.n}</Table.Td>
                          <Table.Td ta="right">{fmt(r.velo)}</Table.Td>
                          <Table.Td ta="right">{fmt(r.max)}</Table.Td>
                          <Table.Td ta="right">{fmt(r.spin, 0)}</Table.Td>
                          <Table.Td ta="right">{fmt(r.ivb)}</Table.Td>
                          <Table.Td ta="right">{fmt(r.hbArm)}</Table.Td>
                          <Table.Td ta="right">{fmt(r.ext)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>

                {isOpen && (
                  <Stack gap="xs">
                    <Group gap="xs" align="flex-end">
                      <Select size="xs" label="Change all" data={present.map((c) => ({ value: c, label: `${c} · ${PITCH_LABELS[c]}` }))} value={bulkFrom} onChange={setBulkFrom} w={170} />
                      <Select size="xs" label="to" data={PITCH_OPTIONS} value={bulkTo} onChange={setBulkTo} w={170} />
                      <Button size="xs" variant="default" disabled={!bulkFrom || !bulkTo || bulkFrom === bulkTo} onClick={() => applyBulk(s.key)}>
                        Apply
                      </Button>
                    </Group>
                    <ScrollArea h={Math.min(520, 60 + list.length * 38)}>
                      <Table fz="sm" verticalSpacing={2} striped miw={760} stickyHeader>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>#</Table.Th>
                            <Table.Th>Type</Table.Th>
                            <Table.Th>File tag</Table.Th>
                            <Table.Th>Auto</Table.Th>
                            <Table.Th ta="right">Velo</Table.Th>
                            <Table.Th ta="right">Spin</Table.Th>
                            <Table.Th ta="right">IVB</Table.Th>
                            <Table.Th ta="right">HB (arm +)</Table.Th>
                            <Table.Th ta="right">Ext</Table.Th>
                            <Table.Th ta="right">Spin eff</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {list.map((p, i) => {
                            const changed = types[p.uid] !== p.type;
                            return (
                              <Table.Tr key={p.uid}>
                                <Table.Td>{p.pitchNo ?? i + 1}</Table.Td>
                                <Table.Td>
                                  <Select
                                    size="xs"
                                    data={PITCH_OPTIONS}
                                    value={types[p.uid]}
                                    onChange={(v) => v && setTypes((prev) => ({ ...prev, [p.uid]: v as PitchCode }))}
                                    allowDeselect={false}
                                    w={150}
                                    styles={changed ? { input: { borderColor: "var(--mantine-color-blue-5)" } } : undefined}
                                    leftSection={<Box w={10} h={10} style={{ borderRadius: 5, background: PITCH_COLORS[types[p.uid]] }} />}
                                  />
                                </Table.Td>
                                <Table.Td>{p.tagged ?? <Text span size="xs" c="dimmed">—</Text>}</Table.Td>
                                <Table.Td>{p.auto ?? <Text span size="xs" c="dimmed">—</Text>}</Table.Td>
                                <Table.Td ta="right">{fmt(p.velo)}</Table.Td>
                                <Table.Td ta="right">{fmt(p.spin, 0)}</Table.Td>
                                <Table.Td ta="right">{fmt(p.ivb)}</Table.Td>
                                <Table.Td ta="right">{fmt(p.hb == null ? null : p.hb * arm)}</Table.Td>
                                <Table.Td ta="right">{fmt(p.ext)}</Table.Td>
                                <Table.Td ta="right">{p.spinEff == null ? "—" : `${Math.round(p.spinEff)}%`}</Table.Td>
                              </Table.Tr>
                            );
                          })}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                  </Stack>
                )}
              </Stack>
            </Paper>
          );
        })}
        {preview.skipped > 0 && (
          <Text size="xs" c="dimmed">
            {preview.skipped} rows had no pitch data (velocity or movement missing) and will not be saved.
          </Text>
        )}
      </Stack>

      <Group justify="flex-end" gap="sm">
        {problems.length > 0 && (
          <Text size="sm" c="orange">
            {problems[0]}
          </Text>
        )}
        <Button onClick={submit} loading={saving} disabled={problems.length > 0}>
          Save {included.reduce((n, p) => n + p.pitchCount, 0)} pitches
        </Button>
      </Group>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Savant
// ---------------------------------------------------------------------------

function SavantReview({ preview, saving, onSave }: { preview: SavantPreview; saving: boolean; onSave: (payload: unknown) => void }) {
  const checks = preview.checks as unknown as { flags?: Array<{ message: string }>; fatal?: string[] };
  const fatal = checks.fatal ?? [];
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group gap="lg">
          <Stack gap={0}>
            <Text size="xs" c="dimmed">
              Savant player
            </Text>
            <Text fw={600}>
              {preview.pitcherName ?? "Unknown"} {preview.pitcherId && <Text span size="xs" c="dimmed">{preview.pitcherId}</Text>}
            </Text>
          </Stack>
          <Stack gap={0}>
            <Text size="xs" c="dimmed">
              Linked athlete
            </Text>
            {preview.link ? (
              <Badge color="green" variant="light">
                {preview.link.athleteName}
              </Badge>
            ) : (
              <Text size="sm" c="orange">
                Not linked
              </Text>
            )}
          </Stack>
          <Stack gap={0}>
            <Text size="xs" c="dimmed">
              Pitches
            </Text>
            <Text fw={600}>{preview.rows.toLocaleString()}</Text>
          </Stack>
        </Group>
        {fatal.map((f) => (
          <Alert key={f} color="red" py="xs">
            {f}
          </Alert>
        ))}
        {(checks.flags ?? []).map((f) => (
          <Alert key={f.message} color="orange" py="xs">
            {f.message}
          </Alert>
        ))}
        {!preview.link && (
          <Text size="sm">
            Link this player first with <b>Link athlete</b> on the Pitch Intelligence page, then upload the file again.
          </Text>
        )}
        <Group justify="flex-end">
          <Button onClick={() => onSave({ kind: "savant" })} loading={saving} disabled={!preview.link || fatal.length > 0}>
            Save {preview.rows.toLocaleString()} pitches
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

type NumKey = "count" | "usagePct" | "velo" | "veloMax" | "spinRate" | "ivb" | "hbArm" | "extension" | "vaa" | "spinEfficiency" | "whiffPct";
const NUM_COLUMNS: Array<{ key: NumKey; label: string; step?: number }> = [
  { key: "count", label: "#", step: 1 },
  { key: "usagePct", label: "Usage %" },
  { key: "velo", label: "Velo" },
  { key: "veloMax", label: "Max" },
  { key: "spinRate", label: "Spin", step: 10 },
  { key: "ivb", label: "IVB" },
  { key: "hbArm", label: "HB (arm +)" },
  { key: "extension", label: "Ext" },
  { key: "vaa", label: "VAA" },
  { key: "spinEfficiency", label: "Spin eff %" },
  { key: "whiffPct", label: "Whiff %" },
];

const emptyRow = (): ReportPitchRow => ({
  pitchType: "FF",
  label: null,
  count: null,
  usagePct: null,
  velo: null,
  veloMax: null,
  spinRate: null,
  ivb: null,
  hbAsShown: null,
  hbArm: null,
  extension: null,
  relHeight: null,
  relSide: null,
  vaa: null,
  spinEfficiency: null,
  whiffPct: null,
});

function ScreenshotReview({ preview, file, saving, onSave }: { preview: ScreenshotPreview; file: File; saving: boolean; onSave: (payload: unknown) => void }) {
  const ex = preview.extraction;
  const [athleteUuid, setAthleteUuid] = useState<string | null>(null);
  const [source, setSource] = useState<ReportSource>(ex.source);
  const [reportDate, setReportDate] = useState(ex.reportDate ?? "");
  const [season, setSeason] = useState<number | string>(ex.season ?? "");
  const [level, setLevel] = useState<string | null>(ex.level && LEVELS.includes(ex.level) ? ex.level : null);
  const [throws, setThrows] = useState<string>(ex.throws ?? "");
  const [title, setTitle] = useState(ex.title ?? "");
  const [notes, setNotes] = useState(ex.notes ?? "");
  const [rows, setRows] = useState<ReportPitchRow[]>(ex.pitches.length ? ex.pitches : [emptyRow()]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  const setRow = (i: number, patch: Partial<ReportPitchRow>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const dateOk = !reportDate || /^\d{4}-\d{2}-\d{2}$/.test(reportDate);
  const missingHb = rows.some((r) => r.hbAsShown != null && r.hbArm == null);
  const problems = [
    !athleteUuid && "Pick the athlete.",
    !level && "Pick a level (used for grading).",
    !dateOk && "Date must be YYYY-MM-DD.",
    !rows.length && "Add at least one pitch row.",
    missingHb && "Fill in arm-side HB for every row that shows horizontal break.",
  ].filter(Boolean) as string[];

  function submit() {
    onSave({
      kind: "screenshot",
      report: {
        athleteUuid,
        source,
        reportDate: reportDate || null,
        season: season === "" ? (reportDate ? Number(reportDate.slice(0, 4)) : null) : Number(season),
        level,
        throws: throws === "L" || throws === "R" ? throws : null,
        title: title.trim() || null,
        notes: notes.trim() || null,
        pitches: rows,
        extracted: ex,
      },
    });
  }

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Paper withBorder radius="md" p="xs" style={{ overflow: "hidden" }}>
          {imageUrl &&
            (isPdf ? (
              <iframe src={imageUrl} title="Uploaded report" style={{ width: "100%", height: 480, border: 0 }} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="Uploaded report" style={{ width: "100%", maxHeight: 520, objectFit: "contain" }} />
            ))}
        </Paper>
        <Stack gap="sm">
          {ex.playerName && (
            <Text size="sm">
              Name on the report: <b>{ex.playerName}</b>
            </Text>
          )}
          <AthletePicker suggestions={preview.suggestions} value={athleteUuid} onChange={setAthleteUuid} />
          <Group grow>
            <Select label="Source" data={SOURCE_OPTIONS} value={source} onChange={(v) => v && setSource(v as ReportSource)} allowDeselect={false} />
            <Select label="Level" data={LEVELS} value={level} onChange={setLevel} placeholder={ex.level ? `Read: ${ex.level}` : "Pick level"} />
          </Group>
          <Group grow>
            <TextInput label="Date" placeholder="YYYY-MM-DD" value={reportDate} onChange={(e) => setReportDate(e.currentTarget.value)} error={!dateOk} />
            <NumberInput label="Season" value={season} onChange={setSeason} min={2000} max={2100} allowDecimal={false} />
            <Select label="Throws" data={["R", "L"]} value={throws || null} onChange={(v) => setThrows(v ?? "")} />
          </Group>
          <TextInput label="Title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
          <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} autosize minRows={2} />
          {ex.hbConvention && (
            <Text size="xs" c="dimmed">
              HB on this report: {ex.hbConvention}. The table below shows HB arm-side positive.
            </Text>
          )}
        </Stack>
      </SimpleGrid>

      <Stack gap="xs">
        <Group justify="space-between">
          <Title order={4}>Pitch types</Title>
          <Text size="xs" c="dimmed">
            Read by Claude. Check every number against the image before saving.
          </Text>
        </Group>
        <ScrollArea>
          <Table fz="sm" verticalSpacing={2} miw={1180}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Type</Table.Th>
                <Table.Th>As shown</Table.Th>
                {NUM_COLUMNS.map((c) => (
                  <Table.Th key={c.key}>{c.label}</Table.Th>
                ))}
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r, i) => (
                <Table.Tr key={i}>
                  <Table.Td>
                    <Select size="xs" data={PITCH_OPTIONS} value={r.pitchType} onChange={(v) => v && setRow(i, { pitchType: v as PitchCode })} allowDeselect={false} w={140} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {r.label ?? "—"}
                      {r.hbAsShown != null ? ` · HB ${r.hbAsShown}` : ""}
                    </Text>
                  </Table.Td>
                  {NUM_COLUMNS.map((c) => (
                    <Table.Td key={c.key}>
                      <NumberInput
                        size="xs"
                        w={c.key === "spinRate" ? 80 : 68}
                        hideControls
                        step={c.step ?? 0.1}
                        value={r[c.key] ?? ""}
                        onChange={(v) => setRow(i, { [c.key]: v === "" || v == null ? null : Number(v) } as Partial<ReportPitchRow>)}
                        error={c.key === "hbArm" && r.hbAsShown != null && r.hbArm == null}
                      />
                    </Table.Td>
                  ))}
                  <Table.Td>
                    <ActionIcon variant="subtle" color="red" aria-label="Remove row" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>
                      ✕
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        <Group>
          <Button size="xs" variant="default" onClick={() => setRows((prev) => [...prev, emptyRow()])}>
            Add row
          </Button>
        </Group>
      </Stack>

      <Group justify="flex-end" gap="sm">
        {problems.length > 0 && (
          <Text size="sm" c="orange">
            {problems[0]}
          </Text>
        )}
        <Button onClick={submit} loading={saving} disabled={problems.length > 0}>
          Save report
        </Button>
      </Group>
    </Stack>
  );
}
