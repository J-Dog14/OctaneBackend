"use client";

/**
 * Admin-only "Sync database": refreshes the 8ctane app snapshot (programs,
 * workouts, plyos, users) by running OctaneAiLayer `python -m src.main sync` —
 * the AI Lab "sync" action — and then reloads the Program tabs. The nightly
 * scripts/run_app_db_sync.bat does the same thing on a schedule.
 *
 * Runs where the backend runs (the AI Lab needs the OctaneAiLayer repo and its
 * venv next to this app), so it works on the ThinkPad, not on Railway.
 */

import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { Button, Code, Group, Modal, Progress, Stack, Text } from "@mantine/core";
import { useAiJob } from "@/app/dashboard/ai-lab/useAiJob";
import { useIsAdmin } from "../CoachGuard";
import { useCoachFetcher } from "./fetcher";

function progress(raw: string) {
  const output = raw.replace(/\r/g, "");
  const total = Number(/\[sync\] starting; (\d+) table/.exec(output)?.[1] ?? 0);
  const done = (output.match(/^\[sync\] \S+: \d+ rows/gm) ?? []).length;
  const failed = [...output.matchAll(/^\[sync\] (\S+): FAILED - (.*)$/gm)].map((m) => `${m[1]}: ${m[2]}`);
  const current = [...output.matchAll(/^\[sync\] (\S+) \.\.\.$/gm)].at(-1)?.[1] ?? null;
  // One-line reason when the App DB can't be reached at all (checked before any table).
  const fatal = /^\[sync\] ERROR: (.*)$/m.exec(output)?.[1] ?? null;
  return { total, done: done + failed.length, failed, current, fatal };
}

export function SyncDatabaseButton({ size = "xs" }: { size?: "xs" | "sm" }) {
  const isAdmin = useIsAdmin();
  const [open, setOpen] = useState(false);
  const job = useAiJob();
  const fetcher = useCoachFetcher();
  const { cache, mutate } = useSWRConfig();
  const wasRunning = useRef(false);
  const p = progress(job.output);
  const finished = !job.running && (job.exitCode != null || job.error != null);
  const ok = finished && job.exitCode === 0 && !job.error;

  // When a sync finishes, reload every Program tab / athlete header this browser has open.
  useEffect(() => {
    if (wasRunning.current && !job.running && job.exitCode === 0) {
      const keys = [...cache.keys()].filter((k): k is string => typeof k === "string" && (k.includes("/program") || k.endsWith("/summary")));
      for (const k of keys) void fetcher(k, { refresh: true }).then((d) => mutate(k, d, { revalidate: false })).catch(() => undefined);
    }
    wasRunning.current = job.running;
  }, [job.running, job.exitCode, cache, fetcher, mutate]);

  if (!isAdmin) return null;
  return (
    <>
      <Button size={size} variant="light" color="gray" loading={job.running} onClick={() => setOpen(true)}>
        Sync database
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="Sync the 8ctane app database" size="lg">
        <Stack gap="sm">
          <Text size="sm">
            Copies the latest programs, workouts, plyos and users from the 8ctane app into the backend (the same pull as the nightly
            sync). Takes about a minute.
          </Text>
          {(job.running || finished) && (
            <>
              <Progress value={p.total ? (p.done / p.total) * 100 : job.running ? 5 : 100} animated={job.running} color={p.failed.length || job.error ? "yellow" : "blue"} />
              <Text size="xs" c="dimmed">
                {job.running ? `${p.done}/${p.total || "?"} tables${p.current ? ` · ${p.current}` : ""}` : ok ? `Done · ${p.done} tables` : "Stopped"}
              </Text>
            </>
          )}
          {job.error && <Text size="sm" c="red">{job.error}</Text>}
          {p.fatal && <Text size="sm" c="red">Couldn&apos;t sync: {p.fatal}</Text>}
          {finished && !job.error && !p.fatal && job.exitCode !== 0 && (
            <Text size="sm" c="red">{p.failed.length ? `${p.failed.length} table(s) failed to sync.` : `Sync exited with code ${job.exitCode}.`}</Text>
          )}
          {p.failed.length > 0 && (
            <Code block style={{ maxHeight: 160, overflow: "auto", fontSize: 11 }}>{p.failed.join("\n")}</Code>
          )}
          {ok && !p.failed.length && <Text size="sm" c="green">Synced. The Program tabs are reloading.</Text>}
          <Group justify="flex-end">
            {job.running ? (
              <Button size="xs" variant="subtle" color="red" onClick={() => void job.kill()}>Stop</Button>
            ) : (
              <Button size="xs" onClick={() => void job.run("sync", {}, "Sync database")}>{finished ? "Sync again" : "Sync now"}</Button>
            )}
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
