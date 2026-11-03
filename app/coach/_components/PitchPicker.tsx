"use client";

/**
 * Mechanics + Flight pitch picker: ◀ [highlighted pitch ▾] ▶.
 * The arrows walk every pitch in throw order (across types). The box opens a checklist:
 * All, then each pitch type with its pitches; tick any mix to draw several at once.
 */

import { useState } from "react";
import { ActionIcon, Badge, Button, Checkbox, Group, Popover, ScrollArea, Stack, Text, UnstyledButton } from "@mantine/core";
import { PITCH_COLORS } from "@/lib/pitch-intel/pitch-types";
import type { SyncPitch } from "@/lib/coach/pitchSync";
import { fmt } from "./fetcher";
import { groupLabel, groupOf, pitchVelo, trialKey } from "./pitchSyncNames";

const colorOf = (p: SyncPitch) => (p.tm ? PITCH_COLORS[p.tm.code] : "#9aa4ab");

function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: size, background: color, boxShadow: "0 0 0 1px rgba(255,255,255,0.4)", flex: "none" }} />;
}

export function PitchPicker({
  pitches,
  names,
  selected,
  focusKey,
  onPick,
  onSelect,
}: {
  /** Throw order. */
  pitches: SyncPitch[];
  names: Map<string, string>;
  selected: string[];
  focusKey: string | null;
  onPick: (key: string) => void;
  onSelect: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const order = pitches.map(trialKey);
  const focus = pitches.find((p) => trialKey(p) === focusKey) ?? pitches[0];
  if (!focus) return null;
  const sel = new Set(selected);

  const groups: Array<{ key: string; items: SyncPitch[] }> = [];
  for (const p of pitches) {
    const g = groupOf(p);
    let entry = groups.find((x) => x.key === g);
    if (!entry) groups.push((entry = { key: g, items: [] }));
    entry.items.push(p);
  }

  const step = (dir: -1 | 1) => {
    const i = order.indexOf(trialKey(focus));
    onPick(order[(i + dir + order.length) % order.length]!);
  };
  // Keep throw order in what we hand back.
  const setKeys = (keys: Set<string>) => onSelect(order.filter((k) => keys.has(k)));
  const toggleMany = (keys: string[], on: boolean) => {
    const next = new Set(sel);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    setKeys(next);
  };
  const state = (keys: string[]) => {
    const n = keys.filter((k) => sel.has(k)).length;
    return { checked: n === keys.length, indeterminate: n > 0 && n < keys.length };
  };
  const all = state(order);
  const v = pitchVelo(focus);
  const extra = selected.length - (sel.has(trialKey(focus)) ? 1 : 0);

  return (
    <Group gap={6} wrap="nowrap">
      <ActionIcon variant="light" size="lg" aria-label="Previous pitch" onClick={() => step(-1)} disabled={order.length < 2}>
        ◀
      </ActionIcon>
      <Popover opened={open} onChange={setOpen} position="bottom-start" shadow="md" width={320} withinPortal>
        <Popover.Target>
          <UnstyledButton
            onClick={() => setOpen((o) => !o)}
            aria-label="Choose pitches"
            style={{
              minWidth: 250,
              padding: "6px 12px",
              borderRadius: 6,
              border: `1px solid ${colorOf(focus)}`,
              background: "rgba(255,255,255,0.03)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Dot color={colorOf(focus)} />
            <Text span fw={600} size="sm">
              {names.get(trialKey(focus))}
            </Text>
            {v != null && (
              <Text span size="sm" c="dimmed">
                · {fmt(v)} MPH
              </Text>
            )}
            {extra > 0 && (
              <Text span size="xs" c="dimmed">
                +{extra} more
              </Text>
            )}
            <Text span size="xs" c="dimmed" ml="auto">
              ▾
            </Text>
          </UnstyledButton>
        </Popover.Target>
        <Popover.Dropdown p={8}>
          <ScrollArea.Autosize mah={420}>
            <Stack gap={6}>
              <Checkbox size="xs" label={<Text size="sm" fw={600}>All ({order.length})</Text>} checked={all.checked} indeterminate={all.indeterminate} onChange={(e) => toggleMany(order, e.currentTarget.checked)} />
              {groups.map((g) => {
                const keys = g.items.map(trialKey);
                const st = state(keys);
                return (
                  <Stack key={g.key} gap={4}>
                    <Checkbox
                      size="xs"
                      label={
                        <Group gap={6} wrap="nowrap">
                          <Dot color={colorOf(g.items[0]!)} size={9} />
                          <Text size="sm" fw={600}>{groupLabel(g.key)}</Text>
                        </Group>
                      }
                      checked={st.checked}
                      indeterminate={st.indeterminate}
                      onChange={(e) => toggleMany(keys, e.currentTarget.checked)}
                    />
                    {g.items.map((p) => {
                      const k = trialKey(p);
                      const pv = pitchVelo(p);
                      const isMain = k === trialKey(focus);
                      return (
                        <Group key={k} gap={6} wrap="nowrap" justify="space-between" ml={22}>
                          <Checkbox
                            size="xs"
                            checked={sel.has(k)}
                            onChange={(e) => toggleMany([k], e.currentTarget.checked)}
                            label={
                              <Text size="sm" fw={isMain ? 700 : 400}>
                                {names.get(k)}
                                {pv != null && <Text span size="xs" c="dimmed"> · {fmt(pv)} mph</Text>}
                              </Text>
                            }
                          />
                          {/* With several pitches drawn: which one is the main (highlighted) pitch, and a way to switch. */}
                          {selected.length > 1 && sel.has(k) &&
                            (isMain ? (
                              <Badge size="xs" variant="light" color="gray" style={{ textTransform: "none", flex: "none" }}>
                                Main
                              </Badge>
                            ) : (
                              <Button size="compact-xs" variant="subtle" color="gray" style={{ flex: "none" }} onClick={() => onPick(k)}>
                                Make main
                              </Button>
                            ))}
                        </Group>
                      );
                    })}
                  </Stack>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
        </Popover.Dropdown>
      </Popover>
      <ActionIcon variant="light" size="lg" aria-label="Next pitch" onClick={() => step(1)} disabled={order.length < 2}>
        ▶
      </ActionIcon>
    </Group>
  );
}
