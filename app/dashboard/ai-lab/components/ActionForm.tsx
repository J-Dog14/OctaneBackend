"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button, Checkbox, Group, MultiSelect, NumberInput, Select, Stack, Text, TextInput,
} from "@mantine/core";
import type { PublicAction, PublicParam, SkillInfo, Values } from "../types";
import { AthletePicker, AthletesMultiPicker } from "./AthletePicker";

type Opt = { value: string; label: string };

function initial(action: PublicAction, fixed: Values): Values {
  const v: Values = {};
  for (const p of action.params) {
    if (p.resolvedDefault !== undefined) v[p.name] = p.resolvedDefault;
  }
  return { ...v, ...fixed };
}

function skillOptions(skills: SkillInfo[], filter: PublicParam["filter"]): Opt[] {
  return skills
    .filter((s) => filter === "any" || !filter || (filter === "first" ? s.category === "first" : s.category !== "first"))
    .map((s) => ({ value: s.id, label: s.label }));
}

/**
 * Renders any registry action as a form. `fixed` values (e.g. the athlete
 * chosen at the top of the Athlete tab) are applied and their fields hidden.
 */
export function ActionForm({
  action,
  skills,
  fixed = {},
  sessionDates = [],
  disabled,
  onRun,
}: {
  action: PublicAction;
  skills: SkillInfo[];
  fixed?: Values;
  sessionDates?: string[];
  disabled?: boolean;
  onRun: (values: Values) => void;
}) {
  const [values, setValues] = useState<Values>(() => initial(action, fixed));
  const [athleteObj, setAthleteObj] = useState<Opt | null>(null);
  const [athletesObj, setAthletesObj] = useState<Opt[]>([]);
  const fixedKey = JSON.stringify(fixed);

  useEffect(() => {
    setValues((v) => ({ ...v, ...fixed }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedKey]);

  const set = (name: string, v: Values[string]) => setValues((prev) => ({ ...prev, [name]: v }));
  const visible = action.params.filter((p) => !(p.name in fixed));
  const missing = useMemo(
    () => action.params.filter((p) => p.required && (values[p.name] === undefined || values[p.name] === "" ||
      (Array.isArray(values[p.name]) && (values[p.name] as string[]).length === 0))),
    [action.params, values]
  );

  const field = (p: PublicParam) => {
    const common = { label: p.label, description: p.help, required: p.required };
    const v = values[p.name];
    switch (p.kind) {
      case "athlete":
        return (
          <AthletePicker value={athleteObj} label={p.label}
            onChange={(a) => { setAthleteObj(a); set(p.name, a?.value); }} />
        );
      case "athletes":
        return (
          <AthletesMultiPicker value={athletesObj} max={p.max ?? 4} label={p.label}
            onChange={(a) => { setAthletesObj(a); set(p.name, a.map((x) => x.value)); }} />
        );
      case "date": {
        if (sessionDates.length && /session|as_of/.test(p.name)) {
          return (
            <Select {...common} w={200} clearable searchable placeholder="latest"
              data={sessionDates} value={(v as string) ?? null}
              onChange={(x) => set(p.name, x ?? undefined)} />
          );
        }
        return (
          <TextInput {...common} type="date" w={200} value={(v as string) ?? ""}
            onChange={(e) => set(p.name, e.currentTarget.value || undefined)} />
        );
      }
      case "enum":
        return (
          <Select {...common} w={220} clearable={!p.required} data={p.options ?? []}
            value={(v as string) ?? null} onChange={(x) => set(p.name, x ?? undefined)} />
        );
      case "multi":
        return (
          <MultiSelect {...common} w={320} data={p.options ?? []} value={(v as string[]) ?? []}
            onChange={(x) => set(p.name, x)} />
        );
      case "skill":
        return (
          <Select {...common} w={340} data={skillOptions(skills, p.filter)} value={(v as string) ?? null}
            onChange={(x) => set(p.name, x ?? undefined)} />
        );
      case "int":
      case "float":
        return (
          <NumberInput {...common} w={170} min={p.min} max={p.max} step={p.step ?? 1}
            allowDecimal={p.kind === "float"} value={(v as number) ?? ""}
            onChange={(x) => set(p.name, x === "" ? undefined : Number(x))} />
        );
      case "bool":
        return (
          <Checkbox label={p.label} description={p.help} mt="lg" checked={v === true}
            onChange={(e) => set(p.name, e.currentTarget.checked || undefined)} />
        );
      case "dir":
      case "token":
        return (
          <TextInput {...common} w={p.kind === "dir" ? 460 : 300} placeholder={p.placeholder}
            value={(v as string) ?? ""} onChange={(e) => set(p.name, e.currentTarget.value.trim() || undefined)} />
        );
    }
  };

  const submit = () => {
    if (action.confirm && !window.confirm(action.confirm)) return;
    onRun(values);
  };

  return (
    <Stack gap="xs">
      {visible.length > 0 && (
        <Group align="flex-end" gap="md" wrap="wrap">
          {visible.map((p) => (
            <div key={p.name}>{field(p)}</div>
          ))}
        </Group>
      )}
      <Group gap="sm">
        <Button onClick={submit} disabled={disabled || missing.length > 0}
          variant={action.primary ? "filled" : "light"}>
          {action.label}
        </Button>
        {missing.length > 0 && (
          <Text size="xs" c="dimmed">needs: {missing.map((m) => m.label).join(", ")}</Text>
        )}
      </Group>
    </Stack>
  );
}
