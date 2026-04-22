"use client";

import {
  Stack,
  Text,
  Select,
  Checkbox,
  Group,
  Loader,
} from "@mantine/core";
import { TABLE_OPTIONS, GROUP_CHECKBOXES } from "../constants";
import type { VariableInfo } from "@/app/api/dashboard/research/variables/route";
import type { VarSelector } from "../types";

interface Props {
  label: string;
  value: VarSelector;
  onChange: (v: VarSelector) => void;
  variables: VariableInfo[];
  loadingVars: boolean;
  movements?: string[];
}

export function VariableSelector({
  label,
  value,
  onChange,
  variables,
  loadingVars,
  movements,
}: Props) {
  const selectData = Object.entries(
    variables.reduce<Record<string, Array<{ value: string; label: string }>>>((acc, v) => {
      if (!acc[v.group]) acc[v.group] = [];
      acc[v.group].push({ value: v.key, label: v.label });
      return acc;
    }, {}),
  ).map(([g, opts]) => ({ group: g, items: opts }));

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.05em" }}>
        {label}
      </Text>
      <Select
        label="Table / Movement"
        placeholder="Select a table..."
        data={TABLE_OPTIONS}
        value={value.table || null}
        onChange={(v) =>
          onChange({ ...value, table: v ?? "", variable: "", exerciseName: undefined })
        }
        searchable
        clearable
      />
      <Select
        label="Variable"
        placeholder={
          loadingVars
            ? "Loading variables..."
            : value.table
              ? "Type to search variables..."
              : "Select a table first"
        }
        data={selectData}
        value={value.variable || null}
        onChange={(v) => onChange({ ...value, variable: v ?? "" })}
        disabled={!value.table || loadingVars}
        searchable
        clearable
        rightSection={loadingVars ? <Loader size="xs" /> : undefined}
        maxDropdownHeight={320}
        nothingFoundMessage="No variables match — try a different search"
      />
      {movements && movements.length > 0 && (
        <Select
          label="Exercise / Movement"
          placeholder="All exercises (unfiltered)"
          data={movements.map((m) => ({ value: m, label: m }))}
          value={value.exerciseName ?? null}
          onChange={(v) => onChange({ ...value, exerciseName: v ?? undefined })}
          searchable
          clearable
          maxDropdownHeight={260}
        />
      )}
      <div>
        <Text size="sm" fw={500} mb={4}>
          Age Groups (unchecked = all)
        </Text>
        <Checkbox.Group
          value={value.groups}
          onChange={(v) => onChange({ ...value, groups: v })}
        >
          <Group gap="sm" wrap="wrap">
            {GROUP_CHECKBOXES.map((g) => (
              <Checkbox key={g.value} value={g.value} label={g.label} size="xs" />
            ))}
          </Group>
        </Checkbox.Group>
      </div>
    </Stack>
  );
}
