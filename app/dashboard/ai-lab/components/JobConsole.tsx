"use client";

import { useEffect, useRef, useState } from "react";
import { Anchor, Badge, Button, Code, Group, Paper, ScrollArea, Stack, Text, Title } from "@mantine/core";
import type { AiJob } from "../useAiJob";
import { fileUrl } from "../types";

/** Pull the packet folder name out of whichever result shape a command printed. */
function packetName(result: Record<string, unknown> | null): string | null {
  if (!result) return null;
  const direct = result.packet;
  if (typeof direct === "string") return direct;
  if (direct && typeof direct === "object" && typeof (direct as { packet?: unknown }).packet === "string") {
    return (direct as { packet: string }).packet;
  }
  return null;
}

export function PromptBox({ packet }: { packet: string }) {
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(fileUrl(`packets/${packet}/PROMPT.md`))
      .then((r) => (r.ok ? r.text() : null))
      .then((t) => !cancelled && setText(t))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [packet]);
  if (!text) return null;
  return (
    <Paper withBorder p="sm" radius="md">
      <Group justify="space-between" mb={6}>
        <Text fw={600} size="sm">Cowork prompt — paste this, or drop in the zip</Text>
        <Group gap="xs">
          <Button size="xs" variant="light" onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}>{copied ? "Copied" : "Copy prompt"}</Button>
          <Button size="xs" variant="subtle" component="a" href={fileUrl(`packets/${packet}.zip`, true)}>
            ↓ zip
          </Button>
        </Group>
      </Group>
      <ScrollArea.Autosize mah={260}>
        <Code block style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{text}</Code>
      </ScrollArea.Autosize>
    </Paper>
  );
}

export function JobConsole({ job }: { job: AiJob }) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [job.output]);

  if (!job.label && !job.output && !job.error) return null;
  const packet = packetName(job.result);
  const failed = job.error || (job.exitCode !== null && job.exitCode !== 0);

  return (
    <Paper withBorder p="md" radius="md" mt="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Group gap="xs">
            <Title order={4}>{job.label ?? "Output"}</Title>
            {job.running ? <Badge color="blue" variant="light">running</Badge>
              : failed ? <Badge color="red" variant="light">failed</Badge>
              : <Badge color="green" variant="light">done</Badge>}
          </Group>
          {job.running && (
            <Button size="xs" color="red" variant="outline" onClick={job.kill}>Kill</Button>
          )}
        </Group>

        {job.error && <Text c="red" size="sm">{job.error}</Text>}

        {job.artifacts.length > 0 && (
          <Group gap="sm" wrap="wrap">
            {job.artifacts.map((a) => (
              <Anchor key={a.path} href={fileUrl(a.path, a.path.endsWith(".zip"))} target="_blank" size="sm">
                {a.path.endsWith(".zip") ? "↓ " : "↗ "}{a.label}
              </Anchor>
            ))}
          </Group>
        )}

        {packet && !job.running && <PromptBox packet={packet} />}

        <ScrollArea.Autosize mah={380}>
          <pre style={{
            margin: 0, padding: "0.75rem", background: "var(--bg-inset, #0d1117)", borderRadius: 6,
            fontSize: 12.5, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {job.output || (job.running ? "Starting…" : "")}
            <div ref={endRef} />
          </pre>
        </ScrollArea.Autosize>
      </Stack>
    </Paper>
  );
}
