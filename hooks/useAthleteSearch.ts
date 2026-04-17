"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AthleteOption = { athlete_uuid: string; name: string };

export function useAthleteSearch() {
  const [athleteQuery, setAthleteQuery] = useState("");
  const [athleteOptions, setAthleteOptions] = useState<AthleteOption[]>([]);
  const [athleteSelected, setAthleteSelected] = useState<AthleteOption | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAthletes = useCallback(async (q: string) => {
    const params = new URLSearchParams({ limit: "50" });
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/dashboard/athletes?${params}`);
    const data = await res.json();
    if (res.ok && Array.isArray(data?.items)) {
      setAthleteOptions(
        data.items.map((a: AthleteOption) => ({
          athlete_uuid: a.athlete_uuid,
          name: a.name,
        }))
      );
    } else {
      setAthleteOptions([]);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchAthletes(athleteQuery);
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [athleteQuery, fetchAthletes]);

  return {
    athleteQuery,
    setAthleteQuery,
    athleteOptions,
    athleteSelected,
    setAthleteSelected,
    dropdownOpen,
    setDropdownOpen,
  };
}
