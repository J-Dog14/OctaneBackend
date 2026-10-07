"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Switch,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import type { LinkWithStatus, PullRun, RunStatus } from "@/lib/pitch-intel/db";
import { LinkAthleteModal } from "./LinkAthleteModal";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
};

const STATUS_COLOR: Record<RunStatus, string> = {
  ok: "green",
  flagged: "orange",
  failed: "red",
  running: "blue",
};

function StatusBadge({ status }: { status: RunStatus | null }) {
  if (!status) return <Text size="sm" c="dimmed">—</Text>;
  return (
    <Badge color={STATUS_COLOR[status]} variant="light" size="sm">
      {status}
    </Badge>
  );
}

function shortTime(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? ts.slice(0, 16) : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function runNotes(run: PullRun): string {
  if (run.error) return run.error;
  const flags = run.checks?.flags ?? [];
  return flags.map((f) => f.message).join(" · ");
}

export function PitchIntelContent() {
  const [linkOpen, setLinkOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<{ color: string; text: string } | null>(null);

  const links = useSWR<{ links: LinkWithStatus[] }>("/api/dashboard/pitch-intel/links", fetcher, { refreshInterval: 15_000 });
  const runs = useSWR<{ runs: PullRun[] }>("/api/dashboard/pitch-intel/runs?limit=30", fetcher, { refreshInterval: 10_000 });

  const refresh = () => {
    void links.mutate();
    void runs.mutate();
  };

  async function pullNow(link: LinkWithStatus) {
    setBusy(link.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/dashboard/pitch-intel/links/${link.id}/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Pull failed");
      const r = json.result;
      setMessage({
        color: r.status === "failed" ? "red" : r.status === "flagged" ? "orange" : "green",
        text: `${link.athlete_name}: ${r.status}. ${r.inserted} new, ${r.updated} updated.${r.error ? ` ${r.error}` : ""}`,
      });
    } catch (err) {
      setMessage({ color: "red", text: err instanceof Error ? err.message : "Pull failed" });
    } finally {
      setBusy(null);
      refresh();
    }
  }

  async function togglePull(link: LinkWithStatus, enabled: boolean) {
    const res = await fetch(`/api/dashboard/pitch-intel/links/${link.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pullEnabled: enabled }),
    });
    if (!res.ok) setMessage({ color: "red", text: (await res.json()).error ?? "Update failed" });
    refresh();
  }

  const lastNightly = runs.data?.runs.find((r) => r.trigger === "nightly");
  const nightlyFailed = runs.data?.runs.filter((r) => r.trigger === "nightly" && r.started_at.slice(0, 10) === lastNightly?.started_at.slice(0, 10) && r.status === "failed");

  return (
    <Box p="md">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={2}>Pitch Intelligence</Title>
            <Text size="sm" c="dimmed">
              Baseball Savant data pulled nightly, plus uploaded Trackman files and report screenshots. Open an athlete's dashboard for Ryan's full report, or Sessions for bullpens and saved reports.
            </Text>
          </div>
          <Group gap="xs">
            <Button component={Link} href="/dashboard/pitch-intel/report" variant="light">
              Open dashboard
            </Button>
            <Button component={Link} href="/dashboard/pitch-intel/sessions" variant="light">
              Sessions
            </Button>
            <Button component={Link} href="/dashboard/pitch-intel/upload" variant="light">
              Upload data
            </Button>
            <Button onClick={() => setLinkOpen(true)}>Link athlete</Button>
          </Group>
        </Group>

        {nightlyFailed && nightlyFailed.length > 0 && (
          <Alert color="red" title="Last nightly run had failures">
            {nightlyFailed.map((r) => `${r.athlete_name ?? "Unknown"}: ${r.error ?? "failed"}`).join(" · ")}
          </Alert>
        )}
        {message && (
          <Alert color={message.color} withCloseButton onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}

        <Stack gap="xs">
          <Title order={4}>Linked athletes</Title>
          {links.isLoading ? (
            <Loader size="sm" />
          ) : links.error ? (
            <Alert color="red">{String(links.error.message ?? links.error)}</Alert>
          ) : !links.data?.links.length ? (
            <Text size="sm" c="dimmed">
              No athletes linked yet. Use Link athlete to connect one to Baseball Savant, or Upload data to bring in a Trackman file.
            </Text>
          ) : (
            <ScrollArea>
              <Table striped highlightOnHover verticalSpacing="xs" miw={900}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Athlete</Table.Th>
                    <Table.Th>Source player</Table.Th>
                    <Table.Th>Throws</Table.Th>
                    <Table.Th>Level</Table.Th>
                    <Table.Th ta="right">Pitches</Table.Th>
                    <Table.Th>Last game</Table.Th>
                    <Table.Th>Last pull</Table.Th>
                    <Table.Th>Nightly</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {links.data.links.map((l) => (
                    <Table.Tr key={l.id}>
                      <Table.Td fw={500}>{l.athlete_name}</Table.Td>
                      <Table.Td>
                        {l.source === "savant" ? (
                          <>
                            <a href={`https://baseballsavant.mlb.com/savant-player/${l.source_player_id}`} target="_blank" rel="noreferrer">
                              {l.source_player_name}
                            </a>{" "}
                            <Text span size="xs" c="dimmed">
                              {l.source_player_id}
                            </Text>
                          </>
                        ) : (
                          <Group gap={6} wrap="nowrap">
                            <Badge size="xs" variant="light" color="grape">
                              Trackman
                            </Badge>
                            <Text span size="sm">
                              {l.source_player_name}
                            </Text>
                          </Group>
                        )}
                      </Table.Td>
                      <Table.Td>{l.throws ? `${l.throws}HP` : "—"}</Table.Td>
                      <Table.Td>{l.league ?? l.level ?? "—"}</Table.Td>
                      <Table.Td ta="right">
                        {l.pitch_count.toLocaleString()}
                        <Text span size="xs" c="dimmed">
                          {" "}
                          / {l.season_count} {l.source === "trackman" ? "sessions" : "szn"}
                        </Text>
                      </Table.Td>
                      <Table.Td>{l.last_game_date ?? "—"}</Table.Td>
                      <Table.Td>
                        <Tooltip label={l.last_run_error ?? shortTime(l.last_run_at)} disabled={!l.last_run_at} multiline maw={360}>
                          <Group gap={6} wrap="nowrap">
                            <StatusBadge status={l.last_run_status} />
                            <Text size="xs" c="dimmed">
                              {shortTime(l.last_run_at)}
                            </Text>
                          </Group>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        {l.source === "savant" ? (
                          <Switch size="sm" checked={l.pull_enabled} onChange={(e) => togglePull(l, e.currentTarget.checked)} aria-label="Nightly pulls" />
                        ) : (
                          <Text size="xs" c="dimmed">
                            uploads
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Button
                            size="xs"
                            variant="filled"
                            component={Link}
                            href={`/dashboard/pitch-intel/report?athlete=${l.athlete_uuid}`}
                            disabled={l.pitch_count === 0}
                          >
                            Dashboard
                          </Button>
                          <Button size="xs" variant="light" component={Link} href={`/dashboard/pitch-intel/sessions?athlete=${l.athlete_uuid}`}>
                            Sessions
                          </Button>
                          {l.source === "savant" && (
                            <Button size="xs" variant="light" loading={busy === l.id} onClick={() => pullNow(l)}>
                              Pull now
                            </Button>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </Stack>

        <Stack gap="xs">
          <Title order={4}>Recent pulls</Title>
          {runs.isLoading ? (
            <Loader size="sm" />
          ) : !runs.data?.runs.length ? (
            <Text size="sm" c="dimmed">
              No pulls yet.
            </Text>
          ) : (
            <ScrollArea>
              <Table verticalSpacing={4} fz="sm" miw={900}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Started</Table.Th>
                    <Table.Th>Athlete</Table.Th>
                    <Table.Th>Trigger</Table.Th>
                    <Table.Th>Range</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th ta="right">New</Table.Th>
                    <Table.Th ta="right">Updated</Table.Th>
                    <Table.Th>Notes</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {runs.data.runs.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td>{shortTime(r.started_at)}</Table.Td>
                      <Table.Td>{r.athlete_name ?? "—"}</Table.Td>
                      <Table.Td>{r.trigger}</Table.Td>
                      <Table.Td>{r.date_from && r.date_to ? `${r.date_from} → ${r.date_to}` : "—"}</Table.Td>
                      <Table.Td>
                        <StatusBadge status={r.status} />
                      </Table.Td>
                      <Table.Td ta="right">{r.rows_inserted}</Table.Td>
                      <Table.Td ta="right">{r.rows_updated}</Table.Td>
                      <Table.Td maw={420}>
                        <Text size="xs" c={r.status === "failed" ? "red" : "dimmed"} lineClamp={2}>
                          {runNotes(r)}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </Stack>
      </Stack>

      <LinkAthleteModal
        opened={linkOpen}
        onClose={() => setLinkOpen(false)}
        onLinked={(name) => {
          setMessage({ color: "green", text: `${name} linked. Backfill is running; it appears under Recent pulls as each season finishes.` });
          refresh();
        }}
      />
    </Box>
  );
}
