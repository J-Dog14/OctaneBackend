"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Accordion, Alert, Anchor, Badge, Button, Group, Loader, Paper, SimpleGrid, Stack, Table, Text, Title,
} from "@mantine/core";
import type { AiJob } from "../useAiJob";
import type { AiLabConfigResponse, AthleteStatus, StepState } from "../types";
import { fileUrl } from "../types";
import { ActionForm } from "./ActionForm";
import { AthletePicker } from "./AthletePicker";
import { PromptBox } from "./JobConsole";

const STATE_COLOR: Record<StepState, string> = {
  done: "green", todo: "yellow", waiting: "orange", blocked: "red", optional: "gray",
};
const STATE_LABEL: Record<StepState, string> = {
  done: "done", todo: "to do", waiting: "waiting", blocked: "blocked", optional: "optional",
};

function when(iso?: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? `today ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : d.toLocaleString();
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function AthletePanel({
  cfg,
  job,
  mode,
  refreshKey,
}: {
  cfg: AiLabConfigResponse;
  job: AiJob;
  mode: "athlete" | "first";
  refreshKey: number;
}) {
  const [athlete, setAthlete] = useState<{ value: string; label: string } | null>(null);
  const [status, setStatus] = useState<AthleteStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openPacket, setOpenPacket] = useState<string | null>(null);

  const load = useCallback(async (uuid: string) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/dashboard/ai-lab/status?athleteUuid=${encodeURIComponent(uuid)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setStatus(data as AthleteStatus);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (athlete) void load(athlete.value);
    else setStatus(null);
  }, [athlete, load, refreshKey]);

  const actions = cfg.actions.filter((a) => a.category === mode);
  const primary = actions.find((a) => a.primary);
  const others = actions.filter((a) => a !== primary);
  const fixed = athlete ? { athlete: athlete.value } : undefined;
  const run = (id: string, values: Record<string, unknown>) => {
    const a = cfg.actions.find((x) => x.id === id);
    if (a) void job.run(id, values as never, `${a.label}${athlete ? ` — ${athlete.label}` : ""}`);
  };

  const lastRound = status?.rounds?.[status.rounds.length - 1];
  const waiting = status?.steps.find((s) => s.key === "waiting")?.state === "waiting";
  const oneRound = (status?.rounds?.length ?? 0) <= 1;

  return (
    <Stack gap="md">
      <Group align="flex-end" gap="md">
        <AthletePicker value={athlete} onChange={setAthlete} />
        {athlete && (
          <Button variant="subtle" onClick={() => load(athlete.value)} loading={loading}>Refresh status</Button>
        )}
        {status?.artifacts.coach_reports[0] && (
          <Anchor href={fileUrl(status.artifacts.coach_reports[0].path)} target="_blank" size="sm">
            ↗ latest coach report
          </Anchor>
        )}
      </Group>

      {err && <Alert color="red" title="Status failed">{err}</Alert>}
      {loading && !status && <Group gap="xs"><Loader size="sm" /><Text size="sm" c="dimmed">Reading the warehouse…</Text></Group>}

      {mode === "first" && status && !oneRound && (
        <Alert color="yellow" title="This athlete has history">
          {status.rounds.length} captures on record — the Athlete tab&apos;s mover profile will use all of them.
        </Alert>
      )}

      {status && (
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Paper withBorder p="md" radius="md">
            <Title order={4} mb="xs">Pipeline</Title>
            <Stack gap={6}>
              {status.steps.map((s) => (
                <Group key={s.key} gap="sm" wrap="nowrap" align="flex-start">
                  <Badge color={STATE_COLOR[s.state]} variant="light" w={78}>{STATE_LABEL[s.state]}</Badge>
                  <div>
                    <Text size="sm" fw={600}>{s.label}</Text>
                    <Text size="xs" c="dimmed">{s.detail}</Text>
                  </div>
                </Group>
              ))}
            </Stack>
            {status.nightly && (
              <Text size="xs" c="dimmed" mt="sm">
                Nightly jobs on this machine — Proteus: {when(status.nightly.proteus?.at)} · Mobility:{" "}
                {when(status.nightly.mobility?.at)} · Workbench: {when(status.nightly.workbench?.at)}
              </Text>
            )}
            {waiting && lastRound && athlete && (
              <Group gap="xs" mt="sm">
                <Button size="xs" variant="light" disabled={job.running}
                  onClick={() => run("uais-proteus-pull", { start: shiftDays(lastRound.capture, -14), end: new Date().toISOString().slice(0, 10) })}>
                  Pull Proteus now
                </Button>
                <Button size="xs" variant="light" disabled={job.running} onClick={() => run("uais-mobility-pull", {})}>
                  Pull mobility now
                </Button>
                <Button size="xs" variant="light" disabled={job.running}
                  onClick={() => run("wb-queue-add", { athlete: athlete.value, skill: mode === "first" ? "first-look" : "mover-profile", wait_for: ["proteus", "mobility"], max_wait_days: 5 })}>
                  Queue for tomorrow morning
                </Button>
              </Group>
            )}
          </Paper>

          <Paper withBorder p="md" radius="md">
            <Title order={4} mb={4}>{primary?.label ?? "Run"}</Title>
            <Text size="xs" c="dimmed" mb="sm">{primary?.description}</Text>
            {primary && fixed && (
              <ActionForm action={primary} skills={cfg.skills} fixed={fixed}
                sessionDates={status.session_dates} disabled={job.running}
                onRun={(v) => run(primary.id, v)} />
            )}
            {cfg.headless && !cfg.headless.enabled && (
              <Text size="xs" c="dimmed" mt="sm">
                Headless runs are off (set AI_LAYER_HEADLESS=1 + ANTHROPIC_API_KEY in the AI layer .env and pip install anthropic).
                Packets are built either way.
              </Text>
            )}
          </Paper>
        </SimpleGrid>
      )}

      {status && (
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Paper withBorder p="md" radius="md">
            <Title order={5} mb="xs">In the warehouse</Title>
            <Table striped withRowBorders={false} fz="xs">
              <Table.Thead><Table.Tr><Table.Th>Source</Table.Th><Table.Th>Sessions</Table.Th><Table.Th>First</Table.Th><Table.Th>Latest</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {status.sources.filter((s) => s.n_sessions > 0).map((s) => (
                  <Table.Tr key={s.key}><Table.Td>{s.key}</Table.Td><Table.Td>{s.n_sessions}</Table.Td><Table.Td>{s.first}</Table.Td><Table.Td>{s.latest}</Table.Td></Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {status.profiles.some((p) => p.state !== "current") && (
              <>
                <Title order={6} mt="sm">Profiles to (re)build</Title>
                {status.profiles.filter((p) => p.state !== "current").map((p) => (
                  <Text key={p.as_of_date} size="xs">
                    {p.as_of_date} — {p.state}{p.changed.length ? ` (${p.changed.join(", ")} changed)` : ""}
                  </Text>
                ))}
              </>
            )}
          </Paper>

          <Paper withBorder p="md" radius="md">
            <Title order={5} mb="xs">Rounds (±14 days of each capture)</Title>
            <Table striped withRowBorders={false} fz="xs">
              <Table.Thead><Table.Tr><Table.Th>Capture</Table.Th><Table.Th>Proteus</Table.Th><Table.Th>Mobility</Table.Th><Table.Th>Screen</Table.Th><Table.Th>Force plate</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {status.rounds.slice().reverse().map((r) => (
                  <Table.Tr key={r.capture}>
                    <Table.Td>{r.capture}</Table.Td>
                    {(["proteus", "mobility", "screen", "force_plate"] as const).map((k) => (
                      <Table.Td key={k} c={r[k] ? undefined : "orange"}>{r[k] ?? "—"}</Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {status.rounds.length === 0 && <Text size="xs" c="dimmed">No 3D capture on record.</Text>}
          </Paper>
        </SimpleGrid>
      )}

      {status && (
        <Paper withBorder p="md" radius="md">
          <Title order={5} mb="xs">Outputs</Title>
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            <Stack gap={2}>
              <Text size="xs" fw={700}>Mover profile PDFs</Text>
              {status.artifacts.mover_pdfs.map((a) => (
                <Anchor key={a.path} size="xs" href={fileUrl(a.path)} target="_blank">{a.name}</Anchor>
              ))}
              {!status.artifacts.mover_pdfs.length && <Text size="xs" c="dimmed">none yet</Text>}
            </Stack>
            <Stack gap={2}>
              <Text size="xs" fw={700}>Packets</Text>
              {status.artifacts.packets.map((a) => (
                <Anchor key={a.path} size="xs" component="button" onClick={() => setOpenPacket(openPacket === a.name ? null : a.name)}>
                  {a.name}
                </Anchor>
              ))}
              {!status.artifacts.packets.length && <Text size="xs" c="dimmed">none yet</Text>}
            </Stack>
            <Stack gap={2}>
              <Text size="xs" fw={700}>Coach reports</Text>
              {status.artifacts.coach_reports.slice(0, 5).map((a) => (
                <Anchor key={a.path} size="xs" href={fileUrl(a.path)} target="_blank">{a.name}</Anchor>
              ))}
              {status.queue.length > 0 && <Text size="xs" fw={700} mt="xs">Queued</Text>}
              {status.queue.map((q) => (
                <Text key={q.id} size="xs">{q.skill}: {q.status}{q.message ? ` — ${q.message}` : ""} ({q.id})</Text>
              ))}
            </Stack>
          </SimpleGrid>
          {openPacket && <div style={{ marginTop: 12 }}><PromptBox packet={openPacket} /></div>}
        </Paper>
      )}

      {athlete && others.length > 0 && (
        <Accordion variant="separated" radius="md">
          {others.map((a) => (
            <Accordion.Item key={a.id} value={a.id}>
              <Accordion.Control>
                <Text size="sm" fw={600}>{a.label}</Text>
                <Text size="xs" c="dimmed">{a.description}</Text>
              </Accordion.Control>
              <Accordion.Panel>
                <ActionForm action={a} skills={cfg.skills} fixed={fixed}
                  sessionDates={status?.session_dates ?? []} disabled={job.running}
                  onRun={(v) => run(a.id, v)} />
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      )}
    </Stack>
  );
}
