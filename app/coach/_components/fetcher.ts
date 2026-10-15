import { useSWRConfig } from "swr";
import { createAsyncTtlCache } from "@/lib/cache/asyncTtlCache";
import type { DomainId } from "@/lib/athlete-tracking/types";

/** SWR fetcher for /api/coach/*: throws the API's { error } message on non-2xx. */
export async function coachFetcher<T = unknown>(url: string, options?: { refresh?: boolean; populationVersion?: string }): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      ...(options?.refresh ? { "x-coach-refresh": "1" } : {}),
      ...(options?.populationVersion ? { "x-coach-population-version": options.populationVersion } : {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`);
  return json as T;
}

/** One instance per authenticated coach boundary, never persisted to disk. */
export function createCoachFetcher() {
  const cache = createAsyncTtlCache({ ttlMs: 60_000, maxEntries: 100, maxBytes: 16 * 1024 * 1024 });
  let populationVersion: string | undefined;
  const fetcher = async <T = unknown>(url: string, options?: { refresh?: boolean }): Promise<T> => {
    if (options?.refresh) cache.invalidate(url);
    return cache.getOrLoad(url, () => coachFetcher<T>(url, { ...options, populationVersion }));
  };
  return Object.assign(fetcher, {
    clear: cache.clear,
    setPopulationVersion(version: string) {
      if (populationVersion !== version) cache.clear();
      populationVersion = version;
    },
  });
}

export function useCoachFetcher(): typeof coachFetcher {
  return (useSWRConfig().fetcher as typeof coachFetcher | undefined) ?? coachFetcher;
}

export const swrOpts = { revalidateOnFocus: false, dedupingInterval: 60_000 } as const;

export const trackingKey = (uuid: string, domains?: readonly DomainId[]) => `/api/coach/athletes/${encodeURIComponent(uuid)}/tracking${domains?.length ? `?domains=${encodeURIComponent(domains.join(","))}` : ""}`;
export const summaryKey = (uuid: string) => `/api/coach/athletes/${encodeURIComponent(uuid)}/summary`;
export const pitchingKey = (uuid: string) => `/api/coach/athletes/${encodeURIComponent(uuid)}/pitching`;
export const readinessKey = (uuid: string) => `/api/coach/athletes/${encodeURIComponent(uuid)}/readiness`;
export const assessmentsKey = (uuid: string, kind?: "prosup" | "curveball") => `/api/coach/athletes/${encodeURIComponent(uuid)}/assessments${kind ? `?kind=${kind}` : ""}`;

export type CoachAthleteListItem = {
  athleteUuid: string;
  name: string;
  ageGroup: string | null;
  updatedAt: string;
  has: Record<"pitching" | "hitting" | "athleticScreen" | "mobility" | "proteus" | "readiness" | "armAction" | "proSup", boolean>;
};

export const fmt = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits));

/** "2026-10-13" -> "Oct 13, 2026" (no timezone shift). */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Whole days between a YYYY-MM-DD date and today. */
export function daysAgo(d: string | null | undefined): number | null {
  if (!d) return null;
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  if (!y || !m || !day) return null;
  const then = Date.UTC(y, m - 1, day);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - then) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Per-browser memory of the athletes a coach looked at (convenience only).
// ---------------------------------------------------------------------------

const RECENT_KEY = "coach:recentAthletes";
export type RecentAthlete = { athleteUuid: string; name: string };

/** Raw stored string (stable between calls, so it works as a useSyncExternalStore snapshot). */
export function readRecentRaw(): string {
  try {
    return window.localStorage.getItem(RECENT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function parseRecent(raw: string): RecentAthlete[] {
  try {
    const list = raw ? (JSON.parse(raw) as RecentAthlete[]) : [];
    return Array.isArray(list) ? list.filter((a) => a && typeof a.athleteUuid === "string" && typeof a.name === "string") : [];
  } catch {
    return [];
  }
}

export function rememberAthlete(a: RecentAthlete): void {
  try {
    const next = [a, ...parseRecent(readRecentRaw()).filter((x) => x.athleteUuid !== a.athleteUuid)].slice(0, 8);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: nothing to remember
  }
}
