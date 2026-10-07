"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Code, Loader, Stack, Tabs, Text, Title } from "@mantine/core";
import type { AiLabConfigResponse } from "./types";
import { useAiJob } from "./useAiJob";
import { ActionGrid } from "./components/ActionGrid";
import { AthletePanel } from "./components/AthletePanel";
import { JobConsole } from "./components/JobConsole";
import { QueueList } from "./components/QueueList";

/**
 * AI Lab — the OctaneAiLayer's front end, inside the backend app.
 *
 * Athlete        one athlete end to end: status checklist → prepare → coach report → skill packet / PDF
 * First look     new athlete, one assessment round
 * Compare        athlete vs athlete
 * Group stats    cohort-level statistics (correlate, cross, velocity, session change…)
 * Archetypes     mover taxonomy, clusters, ledger
 * Maintenance    data pulls, norms, cohort refresh, queue, backfills
 *
 * Every button is an entry in lib/ai-lab/actions.ts; skills come from the
 * Python workbench registry (src/workbench/skills.py).
 */
export function AiLabContent() {
  const [cfg, setCfg] = useState<AiLabConfigResponse | null>(null);
  const [cfgErr, setCfgErr] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);
  const job = useAiJob(bump);

  useEffect(() => {
    fetch("/api/dashboard/ai-lab/config")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
        setCfg(d as AiLabConfigResponse);
      })
      .catch((e) => setCfgErr(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <Stack gap="md">
      <div>
        <Title order={1} mb={4}>AI Lab</Title>
        <Text c="dimmed">
          From &ldquo;data landed&rdquo; to a skill-ready packet or mover-profile PDF — status, profiles, coach
          reports, group statistics and archetypes, without the terminal.
        </Text>
      </div>

      {cfgErr && <Alert color="red" title="Could not load AI Lab config">{cfgErr}</Alert>}
      {!cfg && !cfgErr && <Loader size="sm" />}
      {cfg && cfg.problems.length > 0 && (
        <Alert color="yellow" title="AI layer setup">
          {cfg.problems.map((p) => <div key={p}>{p}</div>)}
          <Text size="xs" mt="xs">
            Set <Code>ai_layer_root</Code> / <Code>ai_layer_python</Code> on the Settings page, or AI_LAYER_ROOT /
            AI_LAYER_PYTHON in this app&apos;s .env.
          </Text>
        </Alert>
      )}

      {cfg && (
        <Tabs defaultValue="athlete" keepMounted>
          <Tabs.List mb="md">
            <Tabs.Tab value="athlete">Athlete</Tabs.Tab>
            <Tabs.Tab value="first">First look</Tabs.Tab>
            <Tabs.Tab value="compare">Compare</Tabs.Tab>
            <Tabs.Tab value="group">Group stats</Tabs.Tab>
            <Tabs.Tab value="archetype">Archetypes</Tabs.Tab>
            <Tabs.Tab value="maintenance">Maintenance &amp; queue</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="athlete">
            <AthletePanel cfg={cfg} job={job} mode="athlete" refreshKey={refreshKey} />
          </Tabs.Panel>
          <Tabs.Panel value="first">
            <AthletePanel cfg={cfg} job={job} mode="first" refreshKey={refreshKey} />
          </Tabs.Panel>
          <Tabs.Panel value="compare">
            <ActionGrid cfg={cfg} job={job} category="compare" />
          </Tabs.Panel>
          <Tabs.Panel value="group">
            <Text size="sm" c="dimmed" mb="sm">
              Population statistics. Results land as HTML reports — links appear under the output when a run finishes.
            </Text>
            <ActionGrid cfg={cfg} job={job} category="group" />
          </Tabs.Panel>
          <Tabs.Panel value="archetype">
            <ActionGrid cfg={cfg} job={job} category="archetype" />
          </Tabs.Panel>
          <Tabs.Panel value="maintenance">
            <QueueList refreshKey={refreshKey} />
            <ActionGrid cfg={cfg} job={job} category="maintenance" />
          </Tabs.Panel>
        </Tabs>
      )}

      <JobConsole job={job} />
    </Stack>
  );
}
