"use client";

import type { ReplaceInfo, Video } from "@/lib/videos/service";

export type { ReplaceInfo, Video };
export type VideoList = { videos: Video[]; limit: number; maxBytes: number };

export const LIBRARY_KEY = "/api/coach/videos";
export const athleteVideosKey = (uuid: string) => `/api/coach/athletes/${encodeURIComponent(uuid)}/videos`;
export const mediaSrc = (id: string, download = false) => `/api/coach/videos/${encodeURIComponent(id)}/media${download ? "?download=1" : ""}`;
export const clipLink = (id: string) => `${window.location.origin}/coach/videos?clip=${encodeURIComponent(id)}`;

export class VideoApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public data: Record<string, unknown> = {}) {
    super(message);
  }
}

/** Video data is edited live, so it's never served from the coach suite's 60 s cache. */
export async function videoGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new VideoApiError((json.error as string) ?? `Request failed (${res.status})`, res.status, json.code as string | undefined, json);
  return json as T;
}

export async function videoSend<T = unknown>(method: "POST" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new VideoApiError((json.error as string) ?? `Request failed (${res.status})`, res.status, json.code as string | undefined, json);
  return json as T;
}

export const videoSwr = { revalidateOnFocus: false, dedupingInterval: 2_000 } as const;

export type StartResponse =
  | { id: string; status: "pending"; uploadUrl: string; contentType: string; replaces: ReplaceInfo[] }
  | { id: string; status: "ready" };

/** PUT the original file straight to R2 with byte progress. */
export function putToStorage(url: string, file: File, contentType: string, onProgress: (pct: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new VideoApiError(`Storage rejected the upload (${xhr.status}).`, xhr.status, "STORAGE")));
    xhr.onerror = () => reject(new VideoApiError("Connection interrupted. Please retry the upload.", 0, "NETWORK"));
    xhr.onabort = () => reject(new VideoApiError("Upload cancelled.", 0, "ABORTED"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

/** "2026-10-13" -> "Oct 13, 2026" (no timezone shift). */
export function fmtDay(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** MiB to one decimal, labelled MB (the vault's display). */
export const fmtSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((s) => s[0]).join("").slice(0, 2).toUpperCase();

/** Today in the coach's own time zone, YYYY-MM-DD. */
export const localToday = () => new Date().toLocaleDateString("en-CA");

/** Baseline first, then the most recent clips (the order of the 5 slots). */
export function slotOrder(videos: Video[]): Video[] {
  const base = videos.filter((v) => v.isBaseline);
  const rest = videos.filter((v) => !v.isBaseline).sort((a, b) => b.recordedDate.localeCompare(a.recordedDate) || b.createdAt.localeCompare(a.createdAt));
  return [...base, ...rest];
}
