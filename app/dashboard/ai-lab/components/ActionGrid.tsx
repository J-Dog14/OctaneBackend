"use client";

import { Accordion, Badge, Group, Text } from "@mantine/core";
import type { AiJob } from "../useAiJob";
import type { AiLabConfigResponse, PublicAction } from "../types";
import { ActionForm } from "./ActionForm";

/** Every action in one category as an accordion of forms; primary opens first. */
export function ActionGrid({
  cfg,
  job,
  category,
}: {
  cfg: AiLabConfigResponse;
  job: AiJob;
  category: PublicAction["category"];
}) {
  const actions = cfg.actions
    .filter((a) => a.category === category)
    .sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
  if (!actions.length) return <Text c="dimmed">Nothing here yet.</Text>;
  return (
    <Accordion variant="separated" radius="md" defaultValue={actions[0].id}>
      {actions.map((a) => (
        <Accordion.Item key={a.id} value={a.id}>
          <Accordion.Control>
            <Group gap="xs">
              <Text size="sm" fw={600}>{a.label}</Text>
              {a.target === "uais" && <Badge size="xs" variant="light">UAIS</Badge>}
              {a.confirm && <Badge size="xs" color="orange" variant="light">population-wide</Badge>}
            </Group>
            <Text size="xs" c="dimmed">{a.description}</Text>
          </Accordion.Control>
          <Accordion.Panel>
            <ActionForm action={a} skills={cfg.skills} disabled={job.running}
              onRun={(v) => void job.run(a.id, v, a.label)} />
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}
