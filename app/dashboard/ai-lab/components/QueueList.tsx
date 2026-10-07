"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Group, Paper, Table, Text, Title } from "@mantine/core";
import type { QueueEntry } from "../types";

const COLOR: Record<QueueEntry["status"], string> = {
  pending: "blue", waiting: "orange", done: "green", failed: "red",
};

export function QueueList({ refreshKey }: { refreshKey: number }) {
  const [entries, setEntries] = useState<QueueEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/ai-lab/queue");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setEntries(data.entries as QueueEntry[]);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <Paper withBorder p="md" radius="md" mb="md">
      <Group justify="space-between" mb="xs">
        <Title order={5}>Queue</Title>
        <Button size="xs" variant="subtle" onClick={load}>Refresh</Button>
      </Group>
      {err && <Text c="red" size="sm">{err}</Text>}
      {entries && entries.length === 0 && (
        <Text size="sm" c="dimmed">Empty. Queue a packet from the Athlete tab when Proteus/mobility haven&apos;t landed yet.</Text>
      )}
      {entries && entries.length > 0 && (
        <Table fz="xs" striped>
          <Table.Thead><Table.Tr>
            <Table.Th>Id</Table.Th><Table.Th>Athlete</Table.Th><Table.Th>Skill</Table.Th>
            <Table.Th>Waits for</Table.Th><Table.Th>Status</Table.Th><Table.Th>Message</Table.Th><Table.Th>Added</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {entries.slice().reverse().map((e) => (
              <Table.Tr key={e.id}>
                <Table.Td><code>{e.id}</code></Table.Td>
                <Table.Td>{e.name}</Table.Td>
                <Table.Td>{e.skill}{e.session ? ` @ ${e.session}` : ""}</Table.Td>
                <Table.Td>{e.wait_for.join(", ") || "—"}</Table.Td>
                <Table.Td><Badge size="xs" color={COLOR[e.status]} variant="light">{e.status}</Badge></Table.Td>
                <Table.Td>{e.message ?? ""}</Table.Td>
                <Table.Td>{e.added_at.replace("T", " ").slice(0, 16)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Paper>
  );
}
