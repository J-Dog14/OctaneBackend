"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Alert, Badge, Box, Button, Group, Loader, Paper, ScrollArea, SegmentedControl, Select, Stack, Table, Text, Title, Tooltip } from "@mantine/core";
import type { AthleteSessions, PitchTypeSummary, SessionSummary } from "@/lib/pitch-intel/sessions";
import type { LinkWithStatus } from "@/lib/pitch-intel/db";
import { PITCH_COLORS } from "@/lib/pitch-intel/pitch-types";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
};

const SOURCE_LABEL: Record<string, string> = {
  trackman_summary: "Trackman summary",
  savant: "Savant / scouting",
  claw: "CLAW",
  rapsodo: "Rapsodo",
  other: "Other report",
};

/** 02-INTERPRETING-THE-DATA: whiff% per pitch needs ~30+ swings on that pitch. */
const WHIFF_MIN_SWINGS = 30;

const fmt = (v: number | null | undefined, digits = 1) => (v == null ? "—" : v.toFixed(digits));

/** Colors follow the letter grade the xArsenal engine returns. */
function gradeColor(grade: string | null | undefined): string {
  const g = (grade ?? "").trim().charAt(0).toUpperCase();
  return g === "A" ? "green" : g === "B" ? "teal" : g === "C" ? "yellow" : g === "D" || g === "F" ? "red" : "gray";
}

function ArsenalBadge({ arsenal }: { arsenal: SessionSummary["arsenal"] }) {
  if (!arsenal) return null;
  return (
    <Tooltip label={`xArsenal ${arsenal.score} · graded against ${arsenal.compLevel}`}>
      <Badge color={gradeColor(arsenal.grade)} variant="light" size="lg">
        Arsenal {arsenal.grade} · {arsenal.label}
      </Badge>
    </Tooltip>
  );
}

function TypeTable({ rows, minCount }: { rows: PitchTypeSummary[]; minCount: number }) {
  const showWhiff = rows.some((r) => r.whiffPct != null);
  const showVaa = rows.some((r) => r.vaa != null);
  return (
    <ScrollArea>
      <Table fz="sm" verticalSpacing={4} miw={760}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Pitch</Table.Th>
            <Table.Th ta="right">#</Table.Th>
            <Table.Th ta="right">Usage</Table.Th>
            <Table.Th ta="right">Velo</Table.Th>
            <Table.Th ta="right">Max</Table.Th>
            <Table.Th ta="right">Spin</Table.Th>
            <Table.Th ta="right">IVB</Table.Th>
            <Table.Th ta="right">HB (arm +)</Table.Th>
            <Table.Th ta="right">Ext</Table.Th>
            {showVaa && <Table.Th ta="right">VAA</Table.Th>}
            <Table.Th ta="right">Spin eff</Table.Th>
            {showWhiff && <Table.Th ta="right">Whiff/swing</Table.Th>}
            <Table.Th ta="right">Grade</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => {
            const small = r.count != null && r.count < minCount;
            return (
              <Table.Tr key={r.pitchType}>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Box w={10} h={10} style={{ borderRadius: 5, background: PITCH_COLORS[r.pitchType] }} />
                    <Text size="sm">{r.label}</Text>
                  </Group>
                </Table.Td>
                <Table.Td ta="right">{r.count ?? "—"}</Table.Td>
                <Table.Td ta="right">{r.usagePct == null ? "—" : `${Math.round(r.usagePct)}%`}</Table.Td>
                <Table.Td ta="right">{fmt(r.velo)}</Table.Td>
                <Table.Td ta="right">{fmt(r.veloMax)}</Table.Td>
                <Table.Td ta="right">{r.spinRate ?? "—"}</Table.Td>
                <Table.Td ta="right">{fmt(r.ivb)}</Table.Td>
                <Table.Td ta="right">{fmt(r.hbArm)}</Table.Td>
                <Table.Td ta="right">{fmt(r.extension)}</Table.Td>
                {showVaa && <Table.Td ta="right">{fmt(r.vaa)}</Table.Td>}
                <Table.Td ta="right">{r.spinEfficiency == null ? "—" : `${r.spinEfficiency}%`}</Table.Td>
                {showWhiff && (
                  <Table.Td ta="right">
                    {r.whiffPct == null ? (
                      "—"
                    ) : r.swings != null && r.swings < WHIFF_MIN_SWINGS ? (
                      <Tooltip label={`${r.swings} swings: small sample (wait for ~${WHIFF_MIN_SWINGS})`}>
                        <Text span size="sm" c="dimmed">
                          {Math.round(r.whiffPct)}%*
                        </Text>
                      </Tooltip>
                    ) : (
                      `${Math.round(r.whiffPct)}%`
                    )}
                  </Table.Td>
                )}
                <Table.Td ta="right">
                  {r.grade ? (
                    <Tooltip label={`${r.grade.subtype} · ${r.grade.score}`}>
                      <Badge color={gradeColor(r.grade.grade)} variant="light">
                        {r.grade.grade}
                      </Badge>
                    </Tooltip>
                  ) : small ? (
                    <Text span size="xs" c="dimmed">
                      &lt;{minCount}
                    </Text>
                  ) : (
                    "—"
                  )}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

function AthleteSelect({ value }: { value: string | null }) {
  const router = useRouter();
  const links = useSWR<{ links: LinkWithStatus[] }>("/api/dashboard/pitch-intel/links", fetcher);
  const data = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of links.data?.links ?? []) if (!seen.has(l.athlete_uuid)) seen.set(l.athlete_uuid, l.athlete_name);
    return [...seen.entries()].map(([v, label]) => ({ value: v, label }));
  }, [links.data]);
  return (
    <Select
      placeholder="Pick an athlete"
      data={data}
      value={value}
      searchable
      onChange={(v) => v && router.push(`/dashboard/pitch-intel/sessions?athlete=${v}`)}
      w={280}
      nothingFoundMessage="No linked athletes"
    />
  );
}

export function SessionsContent({ athleteUuid }: { athleteUuid: string | null }) {
  const [filter, setFilter] = useState("all");
  const [deleting, setDeleting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading, error: loadError, mutate } = useSWR<AthleteSessions>(
    athleteUuid ? `/api/dashboard/pitch-intel/athletes/${athleteUuid}/sessions` : null,
    fetcher,
  );

  async function removeReport(id: number) {
    if (!window.confirm("Delete this saved report?")) return;
    setDeleting(id);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/pitch-intel/reports/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Delete failed");
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  const sessions = (data?.sessions ?? []).filter((s) => filter === "all" || (filter === "reports" ? false : s.sessionType === filter));
  const reports = filter === "all" || filter === "reports" ? (data?.reports ?? []) : [];

  return (
    <Box p="md">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={2}>{data ? data.athlete.name : "Sessions"}</Title>
            <Text size="sm" c="dimmed">
              {data
                ? `${data.athlete.throws ? `${data.athlete.throws}HP` : "Throws unknown"} · ${data.athlete.level ?? "no level"} · Trackman sessions and saved reports, with xArsenal grades`
                : "Trackman sessions and saved reports, with xArsenal grades"}
            </Text>
          </div>
          <Group gap="xs">
            <AthleteSelect value={athleteUuid} />
            {athleteUuid && (
              <Button component={Link} href={`/dashboard/pitch-intel/report?athlete=${athleteUuid}`} variant="light">
                Dashboard
              </Button>
            )}
            <Button component={Link} href="/dashboard/pitch-intel/upload">
              Upload
            </Button>
            <Button component={Link} href="/dashboard/pitch-intel" variant="subtle">
              Back
            </Button>
          </Group>
        </Group>

        {error && (
          <Alert color="red" withCloseButton onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {!athleteUuid ? (
          <Text c="dimmed">Pick an athlete to see their sessions.</Text>
        ) : isLoading ? (
          <Loader />
        ) : loadError ? (
          <Alert color="red">{String(loadError.message ?? loadError)}</Alert>
        ) : data ? (
          <>
            <SegmentedControl
              value={filter}
              onChange={setFilter}
              w="fit-content"
              data={[
                { value: "all", label: "All" },
                { value: "game", label: `Games (${data.sessions.filter((s) => s.sessionType === "game").length})` },
                { value: "bullpen", label: `Bullpens (${data.sessions.filter((s) => s.sessionType === "bullpen").length})` },
                { value: "reports", label: `Reports (${data.reports.length})` },
              ]}
            />
            {!sessions.length && !reports.length && (
              <Text c="dimmed">
                Nothing here yet. Drop a Trackman file or a screenshot on the <Link href="/dashboard/pitch-intel/upload">upload page</Link>.
              </Text>
            )}
            {sessions.map((s) => (
              <Paper key={`${s.date}|${s.sessionType}`} withBorder p="md" radius="md">
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Group gap="sm">
                      <Text fw={700}>{s.date}</Text>
                      <Badge color={s.sessionType === "game" ? "blue" : "grape"} variant="light">
                        {s.sessionType === "game" ? "Game" : "Bullpen"}
                      </Badge>
                      <Text size="sm" c="dimmed">
                        {s.pitches} pitches · Trackman
                      </Text>
                    </Group>
                    <ArsenalBadge arsenal={s.arsenal} />
                  </Group>
                  <TypeTable rows={s.byType} minCount={5} />
                  <Text size="xs" c="dimmed">
                    Grades need 5+ pitches of a type in the session. Whiff% marked * has fewer than {WHIFF_MIN_SWINGS} swings.
                  </Text>
                  {s.sourceFiles.length > 0 && (
                    <Text size="xs" c="dimmed">
                      From {s.sourceFiles.join(", ")}
                    </Text>
                  )}
                </Stack>
              </Paper>
            ))}
            {reports.map((r) => (
              <Paper key={`r${r.id}`} withBorder p="md" radius="md">
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Group gap="sm">
                      <Text fw={700}>{r.date ?? (r.season ? String(r.season) : r.createdAt.slice(0, 10))}</Text>
                      <Badge color="cyan" variant="light">
                        {SOURCE_LABEL[r.source] ?? r.source}
                      </Badge>
                      {r.title && <Text size="sm">{r.title}</Text>}
                      {r.level && (
                        <Text size="sm" c="dimmed">
                          {r.level}
                        </Text>
                      )}
                    </Group>
                    <Group gap="xs">
                      <ArsenalBadge arsenal={r.arsenal} />
                      <Button size="xs" variant="subtle" color="red" loading={deleting === r.id} onClick={() => removeReport(r.id)}>
                        Delete
                      </Button>
                    </Group>
                  </Group>
                  <TypeTable rows={r.byType} minCount={0} />
                  {r.notes && (
                    <Text size="sm" c="dimmed">
                      {r.notes}
                    </Text>
                  )}
                  <Text size="xs" c="dimmed">
                    Read from a screenshot. Averages as shown on the report; pitch counts may be missing.
                  </Text>
                </Stack>
              </Paper>
            ))}
          </>
        ) : null}
      </Stack>
    </Box>
  );
}
