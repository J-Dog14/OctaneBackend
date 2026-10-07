"use client";

import { useEffect, useRef, useState } from "react";
import { MultiSelect, Select } from "@mantine/core";

type Opt = { value: string; label: string };

/** Search /api/dashboard/athletes as you type; keeps chosen labels around. */
function useAthleteOptions(query: string, keep: Opt[]) {
  const [opts, setOpts] = useState<Opt[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (query.trim()) params.set("q", query.trim());
      try {
        const res = await fetch(`/api/dashboard/athletes?${params}`);
        const data = await res.json();
        const items: { athlete_uuid: string; name: string }[] = Array.isArray(data?.items) ? data.items : [];
        setOpts(items.map((a) => ({ value: a.athlete_uuid, label: a.name })));
      } catch {
        setOpts([]);
      }
    }, 200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);
  const merged = new Map<string, Opt>();
  for (const o of [...keep, ...opts]) merged.set(o.value, o);
  return Array.from(merged.values());
}

export function AthletePicker({
  value,
  onChange,
  label = "Athlete",
  w = 320,
}: {
  value: Opt | null;
  onChange: (a: Opt | null) => void;
  label?: string;
  w?: number;
}) {
  const [search, setSearch] = useState("");
  const data = useAthleteOptions(search, value ? [value] : []);
  return (
    <Select
      label={label}
      placeholder="Search by name…"
      searchable
      clearable
      w={w}
      data={data}
      value={value?.value ?? null}
      searchValue={search}
      onSearchChange={setSearch}
      filter={({ options }) => options}
      nothingFoundMessage="No athletes"
      onChange={(v) => onChange(v ? data.find((d) => d.value === v) ?? null : null)}
    />
  );
}

export function AthletesMultiPicker({
  value,
  onChange,
  max,
  label = "Athletes",
}: {
  value: Opt[];
  onChange: (a: Opt[]) => void;
  max: number;
  label?: string;
}) {
  const [search, setSearch] = useState("");
  const data = useAthleteOptions(search, value);
  return (
    <MultiSelect
      label={label}
      placeholder={value.length ? "" : "Search by name…"}
      searchable
      clearable
      maxValues={max}
      w={520}
      data={data}
      value={value.map((v) => v.value)}
      searchValue={search}
      onSearchChange={setSearch}
      filter={({ options }) => options}
      onChange={(ids) => onChange(ids.map((id) => data.find((d) => d.value === id)!).filter(Boolean))}
    />
  );
}
