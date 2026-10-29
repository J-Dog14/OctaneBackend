/**
 * Video Hub rules: pure functions, no I/O (tested in tests/videos.test.ts).
 *
 * The cap: an athlete keeps at most VIDEO_LIMIT clips. Their oldest clip (by recorded
 * date) is the baseline, the reference we always come back to, and is never rotated
 * out. Saving another clip at the cap rotates out the oldest non-baseline clip, so the
 * athlete always has baseline + the most recent (VIDEO_LIMIT - 1).
 */

export const VIDEO_LIMIT = 5; // keep in step with coach.athlete_video_limit() in create_coach_videos.sql
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MiB (the vault allowed 50 MiB; iPhone 4K clips run larger)
export const CATEGORIES = ["Pitching", "Hitting"] as const;
export type Category = (typeof CATEGORIES)[number];
export const VIDEO_MIMES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export type VideoMime = (typeof VIDEO_MIMES)[number];
export const LIMITS = { title: 160, notes: 2000, filename: 200 } as const;

/**
 * Browser MIME → stored MIME. Photo-library exports can have an empty or generic type,
 * so fall back to the extension (same rules as the vault's lib/video-file.ts).
 */
export function videoMime(type: string | null | undefined, name: string): VideoMime | null {
  const mime = (type ?? "").toLowerCase().split(";")[0].trim();
  if ((VIDEO_MIMES as readonly string[]).includes(mime)) return mime as VideoMime;
  if (mime === "video/x-m4v") return "video/mp4";
  if (mime && mime !== "application/octet-stream") return null;
  const ext = name.toLowerCase().split(".").pop();
  return ext === "mov" ? "video/quicktime" : ext === "mp4" || ext === "m4v" ? "video/mp4" : ext === "webm" ? "video/webm" : null;
}

export function extensionFor(mime: VideoMime): string {
  return mime === "video/quicktime" ? "mov" : mime === "video/webm" ? "webm" : "mp4";
}

/** ISO-BMFF / QuickTime top-level boxes a MOV/MP4 file can start with. */
const QT_BOXES = new Set(["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot", "uuid"]);

/** Do the first bytes of the uploaded object look like the container its MIME claims? */
export function sniffMatches(mime: VideoMime, head: Uint8Array): boolean {
  if (mime === "video/webm") return head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  if (head.length < 8) return false;
  const box = String.fromCharCode(head[4], head[5], head[6], head[7]);
  return QT_BOXES.has(box);
}

/** Real calendar date in YYYY-MM-DD, not in the future (one day of slack for time zones). */
export function isRecordedDate(value: string, today = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
  if (y < 2000) return false;
  return dt.getTime() <= today.getTime() + 36 * 3600 * 1000;
}

/** Filename safe to store and to put in Content-Disposition (kept readable, path parts dropped). */
export function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  return (cleaned || "video").slice(0, LIMITS.filename);
}

export type ClipOrder = { id: string; recordedDate: string; createdAt: string };

/** Oldest first: recorded date, then when it was uploaded, then id (deterministic). */
export function compareClips(a: ClipOrder, b: ClipOrder): number {
  return a.recordedDate.localeCompare(b.recordedDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/** Id of the athlete's baseline clip (oldest), or null when they have none. */
export function baselineId<T extends ClipOrder>(clips: readonly T[]): string | null {
  if (!clips.length) return null;
  return [...clips].sort(compareClips)[0].id;
}

export type RotationPlan<T extends ClipOrder> =
  | { kind: "fits" }
  | { kind: "rotate"; evict: T[] }
  /** The new clip would be the one rotated out (older than every recent clip but not the oldest). */
  | { kind: "too_old"; oldestRecent: T };

/**
 * What saving `incoming` does to an athlete who already has `existing` ready clips.
 * Keeps the oldest of all (baseline) plus the newest (limit - 1) of the rest.
 */
export function planRotation<T extends ClipOrder>(existing: readonly T[], incoming: ClipOrder, limit = VIDEO_LIMIT): RotationPlan<T> {
  if (existing.length < limit) return { kind: "fits" };
  const all = [...existing, incoming].sort(compareClips);
  const rest = all.slice(1).reverse(); // newest first
  const dropped = rest.slice(limit - 1);
  if (dropped.some((c) => c.id === incoming.id)) {
    const recent = existing.filter((c) => c.id !== all[0].id).sort(compareClips);
    return { kind: "too_old", oldestRecent: recent[0] ?? existing[0] };
  }
  return { kind: "rotate", evict: dropped as T[] };
}

export type UploadInput = {
  clientKey: string;
  athleteUuid: string;
  category: Category;
  title: string;
  notes: string;
  recordedDate: string;
  filename: string;
  mime: VideoMime;
  size: number;
  /** Clips the coach agreed to rotate out (from a REPLACE_REQUIRED answer). */
  confirmReplaceIds: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export const ATHLETE_UUID = /^[A-Za-z0-9-]{1,64}$/;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validate the "start upload" body. Messages are shown to the coach as-is. */
export function parseUploadInput(body: unknown, today = new Date()): Parsed<UploadInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
  const title = str("title").trim();
  const notes = str("notes").trim();
  const recordedDate = str("recordedDate");
  const filename = cleanFilename(str("filename"));
  const size = typeof b.size === "number" ? b.size : NaN;
  const mime = videoMime(str("mime"), filename);
  if (!isUuid(b.clientKey)) return { ok: false, error: "Missing upload key. Refresh and try again." };
  if (!ATHLETE_UUID.test(str("athleteUuid"))) return { ok: false, error: "Choose an athlete." };
  if (!(CATEGORIES as readonly string[]).includes(str("category"))) return { ok: false, error: "Choose Pitching or Hitting." };
  if (!title || title.length > LIMITS.title) return { ok: false, error: `Add a clip title (up to ${LIMITS.title} characters).` };
  if (notes.length > LIMITS.notes) return { ok: false, error: `Coaching notes are limited to ${LIMITS.notes} characters.` };
  if (!isRecordedDate(recordedDate, today)) return { ok: false, error: "Enter the real date the clip was recorded." };
  if (!mime) return { ok: false, error: "Choose a MOV, MP4, M4V, or WebM video." };
  if (!Number.isInteger(size) || size <= 0) return { ok: false, error: "That file is empty." };
  if (size > MAX_VIDEO_BYTES) return { ok: false, error: `Choose a video under ${MAX_VIDEO_BYTES / 1024 / 1024} MB. Trim it in Photos first.` };
  const confirmReplaceIds = parseIdList(b.confirmReplaceIds);
  if (!confirmReplaceIds) return { ok: false, error: "Invalid replacement choice." };
  return {
    ok: true,
    value: { clientKey: (b.clientKey as string).toLowerCase(), athleteUuid: str("athleteUuid"), category: str("category") as Category, title, notes, recordedDate, filename, mime, size, confirmReplaceIds },
  };
}

/** Optional list of clip ids (max 10); null when malformed. */
export function parseIdList(v: unknown): string[] | null {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 10 || !v.every(isUuid)) return null;
  return v.map((x) => x.toLowerCase());
}

/** The coach confirmed every clip that will be rotated out. */
export function confirmedAll(evictIds: readonly string[], confirmed: readonly string[]): boolean {
  return evictIds.every((id) => confirmed.includes(id.toLowerCase()));
}

export type EditInput = Partial<{ title: string; notes: string; recordedDate: string; category: Category }>;

/** Validate a clip edit (only the fields sent are changed). */
export function parseEditInput(body: unknown, today = new Date()): Parsed<EditInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: EditInput = {};
  if ("title" in b) {
    const t = typeof b.title === "string" ? b.title.trim() : "";
    if (!t || t.length > LIMITS.title) return { ok: false, error: `Add a clip title (up to ${LIMITS.title} characters).` };
    out.title = t;
  }
  if ("notes" in b) {
    const n = typeof b.notes === "string" ? b.notes.trim() : "";
    if (n.length > LIMITS.notes) return { ok: false, error: `Coaching notes are limited to ${LIMITS.notes} characters.` };
    out.notes = n;
  }
  if ("recordedDate" in b) {
    if (typeof b.recordedDate !== "string" || !isRecordedDate(b.recordedDate, today)) return { ok: false, error: "Enter the real date the clip was recorded." };
    out.recordedDate = b.recordedDate;
  }
  if ("category" in b) {
    if (!(CATEGORIES as readonly unknown[]).includes(b.category)) return { ok: false, error: "Choose Pitching or Hitting." };
    out.category = b.category as Category;
  }
  if (!Object.keys(out).length) return { ok: false, error: "Nothing to change." };
  return { ok: true, value: out };
}

/** "attachment; filename*=UTF-8''..." with an ASCII fallback. */
export function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
