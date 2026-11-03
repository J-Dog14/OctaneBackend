"use client";

/**
 * Pitch picker (TM + 3D and Pitching → Flight): ◀ [highlighted pitch ▾] ▶.
 * The arrows walk every pitch in throw order (across types). The box opens a checklist:
 * All, then each pitch type with its pitches; tick any mix to draw several at once.
 * `PitchListPicker` takes plain items; `PitchPicker` adapts TM + 3D's SyncPitch rows to it.
 */

import { useState } from "react";
import { ActionIcon, Badge, Button, Checkbox, Group, Popover, ScrollArea, Stack, Text, UnstyledButton } from "@mantine/core";
import { PITCH_COLORS } from "@/lib/pitch-intel/pitch-types";
import type { SyncPitch } from "@/lib/coach/pitchSync";
import { fmt } from "./fetcher";
import { groupLabel, groupOf, pitchVelo, trialKey } from "./pitchSyncNames";

const colorOf = (p: SyncPitch) => (p.tm ? PITCH_COLORS[p.tm.code] : "#9aa4ab");

export interface PickItem {
  key: string;
  /** Short name, e.g. "Sinker 4". */
  name: string;
  color: string;
  /** Group id (pitch type) and its label in the checklist ("Sinkers"). */
  group: string;
  groupLabel: string;
  velo: number | null;
}

function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: size, background: color, boxShadow: "0 0 0 1px rgba(255,255,255,0.4)", flex: "none" }} />;
}

export function PitchPicker({
  pitches,
  names,
  ...rest
}: {
  /** Throw order. */
  pitches: SyncPitch[];
  names: Map<string, string>;
  selected: string[];
  focusKey: string | null;
  onPick: (key: string) => void;
  onSelect: (keys: string[]) => void;
}) {
  const items: PickItem[] = pitches.map((p) => {
    const g = groupOf(p);
    return { key: trialKey(p), name: names.get(trialKey(p)) ?? "", color: colorOf(p), group: g, groupLabel: groupLabel(g), velo: pitchVelo(p) };
  });
  return <PitchListPicker items={items} {...rest} />;
}

export function PitchListPicker({
  items,
  selected,
  focusKey,
  onPick,
  onSelect,
}: {
  /** Throw order. */
  items: PickItem[];
  selected: string[];
  focusKey: string | null;
  onPick: (key: string) => void;
  onSelect: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const order = items.map((p) => p.key);
  const focus = items.find((p) => p.key === focusKey) ?? items[0];
  if (!focus) return null;
  const sel = new Set(selected);

  const groups: Array<{ key: string; label: string; items: PickItem[] }> = [];
  for (const p of items) {
    let entry = groups.find((x) => x.key === p.group);
    if (!entry) groups.push((entry = { key: p.group, label: p.groupLabel, items: [] }));
    entry.items.push(p);
  }

  const step = (dir: -1 | 1) => {
    const i = order.indexOf(focus.key);
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
  const v = focus.velo;
  const extra = selected.length - (sel.has(focus.key) ? 1 : 0);
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
              border: `1px solid ${focus.color}`,
              background: "rgba(255,255,255,0.03)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Dot color={focus.color} />
            <Text span fw={600} size="sm">
              {focus.name}
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
                const keys = g.items.map((p) => p.key);
                const st = state(keys);
                return (
                  <Stack key={g.key} gap={4}>
                    <Checkbox
                      size="xs"
                      label={
                        <Group gap={6} wrap="nowrap">
                          <Dot color={g.items[0]!.color} size={9} />
                          <Text size="sm" fw={600}>{g.label}</Text>
                        </Group>
                      }
                      checked={st.checked}
                      indeterminate={st.indeterminate}
                      onChange={(e) => toggleMany(keys, e.currentTarget.checked)}
                    />
                    {g.items.map((p) => {
                      const k = p.key;
                      const pv = p.velo;
                      const isMain = k === focus.key;
                      return (
                        <Group key={k} gap={6} wrap="nowrap" justify="space-between" ml={22}>
                          <Checkbox
                            size="xs"
                            checked={sel.has(k)}
                            onChange={(e) => toggleMany([k], e.currentTarget.checked)}
                            label={
                              <Text size="sm" fw={isMain ? 700 : 400}>
                                {p.name}
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
