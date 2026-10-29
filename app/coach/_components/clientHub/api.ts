"use client";

import type { getClientDetail, listHub } from "@/lib/client-hub/service";
import type { SyncResult } from "@/lib/client-hub/appSync";
import type { Tone } from "@/lib/client-hub/flags";

export type HubList = Awaited<ReturnType<typeof listHub>>;
export type HubDetail = Awaited<ReturnType<typeof getClientDetail>>;
export type { SyncResult };

export const HUB = "/api/coach/client-hub";
export const listKey = (params: URLSearchParams) => `${HUB}/clients?${params}`;
export const detailKey = (id: string) => `${HUB}/clients/${encodeURIComponent(id)}`;

export class HubError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

/** Hub data is edited live, so it's never served from the coach suite's 60 s cache. */
export async function hubGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new HubError((json as { error?: string }).error ?? `Request failed (${res.status})`, (json as { code?: string }).code);
  return json as T;
}

export async function hubSend<T = unknown>(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new HubError((json as { error?: string }).error ?? `Request failed (${res.status})`, (json as { code?: string }).code);
  return json as T;
}

export const hubSwr = { revalidateOnFocus: false, dedupingInterval: 2_000 } as const;

export const TONE_COLOR: Record<Tone, string | undefined> = {
  bad: "var(--accent-red)",
  warn: "var(--accent-yellow)",
  ok: "var(--accent-green)",
  muted: "var(--text-muted)",
  none: undefined,
};

export const STATUS_COLOR: Record<string, string> = { active: "green", paused: "yellow", expired: "gray" };
export const STATUS_LABEL: Record<string, string> = { active: "Active", paused: "Paused", expired: "Expired" };

/** "2026-10-13" -> "Oct 13, 2026" (no timezone shift). */
export function fmtDay(d: string | null | undefined, withYear = true): string {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

export function ago(days: number | null | undefined): string {
  if (days == null) return "—";
  if (days === 0) return "today";
  return days > 0 ? `${days}d ago` : `in ${-days}d`;
}
