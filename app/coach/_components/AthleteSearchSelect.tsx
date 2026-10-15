"use client";

import { useMemo, useState } from "react";
import { Select } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import useSWR from "swr";
import { swrOpts, type CoachAthleteListItem } from "./fetcher";
import type { ComparisonScope } from "@/lib/coach/comparison";
import type { DomainId } from "@/lib/athlete-tracking/types";

type Props = {
  value: string | null;
  onChange: (athleteUuid: string | null, name: string | null) => void;
  /** Athletes not offered (e.g. the one already on screen). */
  exclude?: string[];
  placeholder?: string;
  w?: number | string;
  size?: "xs" | "sm" | "md";
  /** Label to show for `value` before a search has returned it. */
  valueLabel?: string | null;
  dataScope?: ComparisonScope;
  domain?: DomainId;
};

/** Searchable athlete picker backed by /api/coach/athletes. */
export function AthleteSearchSelect({ value, onChange, exclude = [], placeholder = "Search athletes…", w = 260, size = "sm", valueLabel, dataScope = "all", domain }: Props) {
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 200);
  const [known, setKnown] = useState<Record<string, string>>({});
  const { data, isLoading, error } = useSWR<{ items: CoachAthleteListItem[] }>(
    `/api/coach/athletes?limit=25&scope=${dataScope}${domain ? `&domain=${domain}` : ""}${debounced.trim() ? `&q=${encodeURIComponent(debounced.trim())}` : ""}`,
    swrOpts,
  );

  const options = useMemo(() => {
    const items = (data?.items ?? []).filter((a) => !exclude.includes(a.athleteUuid));
    const opts = items.map((a) => ({ value: a.athleteUuid, label: a.name }));
    // Keep the current value selectable even when it isn't in this page of results.
    if (value && !opts.some((o) => o.value === value)) opts.unshift({ value, label: valueLabel ?? known[value] ?? "Selected athlete" });
    return opts;
  }, [data, exclude, value, known, valueLabel]);

  return (
    <Select
      searchable
      clearable
      value={value}
      data={options}
      placeholder={placeholder}
      searchValue={search}
      onSearchChange={setSearch}
      filter={({ options: o }) => o}
      nothingFoundMessage={isLoading ? "Searching…" : error ? "Unable to load athletes" : "No athletes found"}
      onChange={(v) => {
        const label = options.find((o) => o.value === v)?.label ?? null;
        if (v && label) setKnown((k) => ({ ...k, [v]: label }));
        onChange(v, label);
      }}
      w={w}
      size={size}
    />
  );
}
