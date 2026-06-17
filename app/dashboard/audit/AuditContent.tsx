"use client";

import { useEffect, useState } from "react";
import {
  Accordion,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import type { AuditCheck, AuditReport, AuditSeverity } from "@/app/api/dashboard/audit/route";

const SEVERITY_COLOR: Record<AuditSeverity, string> = {
  critical: "red",
  warning: "orange",
  info: "gray",
};

type HistoryEntry = {
  id: string;
  run_at: string;
  duration_ms: number;
  triggered_by: string;
  critical_count: number;
  warning_count: number;
  info_count: number;
};

function CheckRow({ check, onFix }: { check: AuditCheck; onFix: () => void }) {
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState<string | null>(null);
  const color = SEVERITY_COLOR[check.severity];
  const hasIssues = check.count > 0;
  const isError = check.count === -1;

  async function handleFix() {
    if (!check.fixEndpoint) return;
    setFixing(true);
    setFixResult(null);
    try {
      const res = await fetch(check.fixEndpoint, { method: "POST" });
      const json = await res.json();
      setFixResult(res.ok ? "Fixed successfully. Re-run audit to verify." : (json.error ?? "Fix failed."));
      if (res.ok) onFix();
    } catch {
      setFixResult("Fix request failed.");
    } finally {
      setFixing(false);
    }
  }

  const columns = check.rows[0] ? Object.keys(check.rows[0]) : [];

  return (
    <Accordion.Item value={check.id}>
      <Accordion.Control>
        <Group justify="space-between" pr="md">
          <Group gap="sm">
            <Badge color={hasIssues ? color : "green"} variant="filled" size="sm">
              {isError ? "ERROR" : hasIssues ? check.severity.toUpperCase() : "OK"}
            </Badge>
            <Text size="sm" fw={500}>
              {check.label}
            </Text>
          </Group>
          <Badge color={hasIssues ? color : "green"} variant="light">
            {isError ? "failed" : `${check.count} issue${check.count !== 1 ? "s" : ""}`}
          </Badge>
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        <Stack gap="sm">
          {check.autoFixable && hasIssues && (
            <Group>
              <Button size="xs" color="blue" loading={fixing} onClick={handleFix}>
                Fix Automatically
              </Button>
              {fixResult && (
                <Text size="xs" c="dimmed">{fixResult}</Text>
              )}
            </Group>
          )}
          {check.rows.length === 0 ? (
            <Text size="sm" c="dimmed">No issues found.</Text>
          ) : (
            <ScrollArea>
              <Table striped highlightOnHover withTableBorder withColumnBorders fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    {columns.map((col) => (
                      <Table.Th key={col}>{col}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {check.rows.map((row, i) => (
                    <Table.Tr key={i}>
                      {columns.map((col) => (
                        <Table.Td key={col}>{String(row[col] ?? "")}</Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
          {check.count === 50 && (
            <Text size="xs" c="dimmed">Showing first 50 rows — there may be more.</Text>
          )}
        </Stack>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

function AuditHistory({ refreshKey }: { refreshKey: number }) {
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/dashboard/audit/history")
      .then((r) => r.json())
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading) return <Loader size="xs" />;
  if (!history || history.length === 0) {
    return <Text size="sm" c="dimmed">No audit runs recorded yet.</Text>;
  }

  return (
    <ScrollArea>
      <Table fz="xs" withTableBorder withColumnBorders striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Date / Time</Table.Th>
            <Table.Th>Triggered By</Table.Th>
            <Table.Th>Duration</Table.Th>
            <Table.Th>Issues</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {history.map((entry) => (
            <Table.Tr key={entry.id}>
              <Table.Td>{new Date(entry.run_at).toLocaleString()}</Table.Td>
              <Table.Td style={{ textTransform: "capitalize" }}>{entry.triggered_by}</Table.Td>
              <Table.Td>{entry.duration_ms}ms</Table.Td>
              <Table.Td>
                <Group gap={4}>
                  {entry.critical_count > 0 && (
                    <Badge color="red" size="xs" variant="filled">{entry.critical_count} critical</Badge>
                  )}
                  {entry.warning_count > 0 && (
                    <Badge color="orange" size="xs" variant="filled">{entry.warning_count} warn</Badge>
                  )}
                  {entry.info_count > 0 && (
                    <Badge color="gray" size="xs" variant="light">{entry.info_count} info</Badge>
                  )}
                  {entry.critical_count === 0 && entry.warning_count === 0 && entry.triggered_by !== "fix-flags" && (
                    <Badge color="green" size="xs" variant="filled">clean</Badge>
                  )}
                  {entry.triggered_by === "fix-flags" && (
                    <Badge color="blue" size="xs" variant="light">flags recalculated</Badge>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

export function AuditContent() {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  async function runAudit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/audit");
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? `Request failed (${res.status})`);
        return;
      }
      setReport(await res.json());
      setHistoryKey((k) => k + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box p="md" maw={1100} mx="auto">
      <Stack gap="lg">
        <Group justify="space-between" align="center">
          <div>
            <Title order={2}>Database Audit</Title>
            <Text size="sm" c="dimmed">
              Checks athlete flags, session counts, Octane links, and data quality.
            </Text>
          </div>
          <Button onClick={runAudit} loading={loading} disabled={loading}>
            {loading ? "Running…" : "Run Audit"}
          </Button>
        </Group>

        {loading && !report && (
          <Group justify="center" py="xl">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">Running checks…</Text>
          </Group>
        )}

        {error && (
          <Text c="red" size="sm">Error: {error}</Text>
        )}

        {report && (
          <Stack gap="sm">
            <Group gap="xs">
              <Text size="sm" c="dimmed">
                Run at {new Date(report.runAt).toLocaleString()} — {report.durationMs}ms
              </Text>
              {report.summary.critical > 0 && (
                <Badge color="red" variant="filled">{report.summary.critical} critical</Badge>
              )}
              {report.summary.warning > 0 && (
                <Badge color="orange" variant="filled">{report.summary.warning} warnings</Badge>
              )}
              {report.summary.info > 0 && (
                <Badge color="gray" variant="light">{report.summary.info} info</Badge>
              )}
              {report.summary.critical === 0 && report.summary.warning === 0 && (
                <Badge color="green" variant="filled">All clear</Badge>
              )}
            </Group>

            <Accordion variant="separated" multiple>
              {report.checks.map((check) => (
                <CheckRow key={check.id} check={check} onFix={runAudit} />
              ))}
            </Accordion>
          </Stack>
        )}

        <Divider />

        <Stack gap="xs">
          <Title order={4}>Audit History</Title>
          <Text size="xs" c="dimmed">Last 20 audit runs and fix actions.</Text>
          <AuditHistory refreshKey={historyKey} />
        </Stack>
      </Stack>
    </Box>
  );
}
