"use client";

import { useEffect, useMemo, useState } from "react";
import { Select } from "@mantine/core";
import type { AthleteSuggestion } from "@/lib/pitch-intel/links";

interface Props {
  suggestions: AthleteSuggestion[];
  value: string | null;
  onChange: (athleteUuid: string | null) => void;
  label?: string;
  placeholder?: string;
}

/** Athlete select: closest name matches first, and typing searches every athlete in the database. */
export function AthletePicker({ suggestions, value, onChange, label = "Athlete", placeholder = "Search athletes" }: Props) {
  const [search, setSearch] = useState("");
  const [extra, setExtra] = useState<AthleteSuggestion[]>([]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 3) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/dashboard/pitch-intel/athlete-matches?name=${encodeURIComponent(q)}`);
        if (res.ok) setExtra((await res.json()).matches ?? []);
      } catch {
        /* keep previous options */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const data = useMemo(() => {
    const seen = new Set<string>();
    return [...suggestions, ...extra]
      .filter((a) => (seen.has(a.athlete_uuid) ? false : (seen.add(a.athlete_uuid), true)))
      .map((a) => ({
        value: a.athlete_uuid,
        label: `${a.name}${a.age_group ? ` · ${a.age_group}` : ""}${a.date_of_birth ? ` · ${a.date_of_birth}` : ""} (${a.score}%)`,
      }));
  }, [suggestions, extra]);

  return (
    <Select
      label={label}
      placeholder={placeholder}
      data={data}
      value={value}
      onChange={onChange}
      searchable
      clearable
      onSearchChange={setSearch}
      nothingFoundMessage="No athlete found. Add them on the Athletes page first."
      w={360}
    />
  );
}
