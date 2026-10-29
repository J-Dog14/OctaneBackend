/**
 * Video Hub data access + workflows (coach.athlete_videos, see uais/sql/create_coach_videos.sql).
 * Raw SQL like the rest of the coach suite: the coach schema isn't in Prisma.
 *
 * Upload is two calls around a direct browser → R2 PUT:
 *   startUpload    validates, checks the cap, makes a pending row, returns a presigned PUT URL
 *   (browser PUTs the original file to R2, with byte progress)
 *   completeUpload checks the stored bytes (size + container signature), then under a
 *                  per-athlete lock rotates out the oldest non-baseline clip if needed and
 *                  marks the new clip ready.
 * A retried start with the same clientKey reuses the same row, so lost responses never
 * duplicate a clip. Nothing in this file can delete an athlete.
 */

import { prisma } from "@/lib/db/prisma";
import {
  baselineId,
  compareClips,
  confirmedAll,
  isUuid,
  MAX_VIDEO_BYTES,
  planRotation,
  sniffMatches,
  VIDEO_LIMIT,
  type Category,
  type EditInput,
  type UploadInput,
  type VideoMime,
} from "./rules";
import { deleteObjectQuietly, objectHead, objectKeyFor, objectSize, presignMedia, presignUpload } from "./storage";

export type Actor = { clerkUserId: string; name: string };

export type Video = {
  id: string;
  athleteUuid: string;
  athleteName: string;
  category: Category;
  title: string;
  notes: string;
  recordedDate: string;
  filename: string;
  mime: VideoMime;
  sizeBytes: number;
  uploadedByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** The athlete's oldest clip: kept when the cap rotates clips out. */
  isBaseline: boolean;
};

export type ReplaceInfo = Pick<Video, "id" | "title" | "recordedDate" | "category">;

export class VideoError extends Error {
  constructor(public status: number, message: string, public code?: string, public extra?: Record<string, unknown>) {
    super(message);
    this.name = "VideoError";
  }
}

export class VideosNotInstalledError extends Error {
  constructor() {
    super("The Video Hub table is missing. Run `npm run videos:setup` (uais/sql/create_coach_videos.sql) against the warehouse.");
    this.name = "VideosNotInstalledError";
  }
}

type Q = <T = Record<string, unknown>>(sql: string, ...params: unknown[]) => Promise<T[]>;
const q: Q = (sql, ...params) => prisma.$queryRawUnsafe(sql, ...params);

/** Missing coach.athlete_videos → VideosNotInstalledError; anything else rethrown. */
async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof VideoError) throw err;
    const msg = String(err);
    if (msg.includes("3F000") || (msg.includes("athlete_video") && (msg.includes("does not exist") || msg.includes("42P01") || msg.includes("42883")))) {
      throw new VideosNotInstalledError();
    }
    if (msg.includes("athlete_videos_limit")) {
      throw new VideoError(409, `This athlete already has ${VIDEO_LIMIT} videos. Delete one first.`, "LIMIT");
    }
    throw err;
  }
}

const COLUMNS = `
  v.id::text AS id, v.athlete_uuid AS "athleteUuid", a.name AS "athleteName", v.category, v.title, v.notes,
  v.recorded_date::text AS "recordedDate", v.filename, v.mime, v.size_bytes::float8 AS "sizeBytes",
  v.uploaded_by_name AS "uploadedByName", v.created_at::text AS "createdAt", v.updated_at::text AS "updatedAt"`;

type Row = Omit<Video, "isBaseline">;

function withBaseline(rows: Row[]): Video[] {
  const byAthlete = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byAthlete.get(r.athleteUuid) ?? [];
    list.push(r);
    byAthlete.set(r.athleteUuid, list);
  }
  const baselines = new Set([...byAthlete.values()].map((list) => baselineId(list)));
  // Newest recorded first, then newest upload (the vault's library order).
  return rows
    .map((r) => ({ ...r, isBaseline: baselines.has(r.id) }))
    .sort((a, b) => -compareClips(a, b));
}

/** Every ready clip with its athlete. The cap keeps this small (≤ 5 per athlete). */
export async function listLibrary(): Promise<{ videos: Video[]; limit: number; maxBytes: number }> {
  const rows = await guard(() =>
    q<Row>(`SELECT ${COLUMNS} FROM coach.athlete_videos v JOIN analytics.d_athletes a USING (athlete_uuid)
            WHERE v.status = 'ready' ORDER BY v.recorded_date DESC, v.created_at DESC LIMIT 10000`),
  );
  return { videos: withBaseline(rows), limit: VIDEO_LIMIT, maxBytes: MAX_VIDEO_BYTES };
}

export async function listForAthlete(athleteUuid: string): Promise<{ videos: Video[]; limit: number; maxBytes: number }> {
  const rows = await guard(() =>
    q<Row>(`SELECT ${COLUMNS} FROM coach.athlete_videos v JOIN analytics.d_athletes a USING (athlete_uuid)
            WHERE v.status = 'ready' AND v.athlete_uuid = $1`, athleteUuid),
  );
  return { videos: withBaseline(rows), limit: VIDEO_LIMIT, maxBytes: MAX_VIDEO_BYTES };
}

/** Ready clips per athlete (for the coach summary's tab badge). */
export async function videoCount(athleteUuid: string): Promise<{ n: number; last: string | null }> {
  const rows = await guard(() =>
    q<{ n: number; last: string | null }>(
      `SELECT count(*)::int AS n, max(recorded_date)::text AS last FROM coach.athlete_videos WHERE athlete_uuid = $1 AND status = 'ready'`,
      athleteUuid,
    ),
  );
  return rows[0] ?? { n: 0, last: null };
}

const toReplace = (v: Row): ReplaceInfo => ({ id: v.id, title: v.title, recordedDate: v.recordedDate, category: v.category });

function replaceRequired(evict: Row[]): VideoError {
  const list = evict.map(toReplace);
  const what = list.map((r) => `"${r.title}" (${r.recordedDate})`).join(", ");
  return new VideoError(409, `This athlete has ${VIDEO_LIMIT} videos. Saving this clip removes ${what}.`, "REPLACE_REQUIRED", { replaces: list });
}

function tooOld(oldestRecent: Row): VideoError {
  return new VideoError(
    409,
    `This athlete has ${VIDEO_LIMIT} videos and this clip is older than every recent one, so it would be removed right away. Delete a clip first, or check the recorded date.`,
    "TOO_OLD",
    { oldestRecent: toReplace(oldestRecent) },
  );
}

/** Pending uploads older than this never finished (tab closed, phone locked): clean them up. */
const ABANDON_AFTER = "6 hours";

async function sweepAbandoned(athleteUuid?: string): Promise<void> {
  const rows = await q<{ id: string; key: string; athleteUuid: string }>(
    `UPDATE coach.athlete_videos SET status = 'deleted', deleted_at = now(), delete_reason = 'abandoned', updated_at = now()
      WHERE status = 'pending' AND created_at < now() - interval '${ABANDON_AFTER}' ${athleteUuid ? "AND athlete_uuid = $1" : ""}
      RETURNING id::text AS id, object_key AS key, athlete_uuid AS "athleteUuid"`,
    ...(athleteUuid ? [athleteUuid] : []),
  );
  for (const r of rows) {
    await q(`INSERT INTO coach.athlete_video_events (video_id, athlete_uuid, action, actor) VALUES ($1::uuid, $2, 'abandon', 'system') RETURNING id`, r.id, r.athleteUuid);
    await deleteObjectQuietly(r.key);
  }
}

export type StartResult =
  | { id: string; status: "pending"; uploadUrl: string; contentType: VideoMime; replaces: ReplaceInfo[] }
  | { id: string; status: "ready" };

export async function startUpload(input: UploadInput, actor: Actor): Promise<StartResult> {
  return guard(async () => {
    const athlete = await q<{ name: string }>(`SELECT name FROM analytics.d_athletes WHERE athlete_uuid = $1`, input.athleteUuid);
    if (!athlete.length) throw new VideoError(404, "Athlete not found");

    // Same clientKey = a retry of an upload we already know about.
    const prior = await q<{ id: string; status: string; athleteUuid: string; key: string; mime: VideoMime; size: number }>(
      `SELECT id::text AS id, status, athlete_uuid AS "athleteUuid", object_key AS key, mime, size_bytes::float8 AS size
         FROM coach.athlete_videos WHERE client_key = $1::uuid`,
      input.clientKey,
    );
    if (prior.length) {
      const p = prior[0];
      if (p.athleteUuid !== input.athleteUuid || p.size !== input.size || p.mime !== input.mime) throw new VideoError(409, "This upload key was used for a different file. Refresh and try again.");
      if (p.status === "ready") return { id: p.id, status: "ready" };
      if (p.status === "deleted") throw new VideoError(410, "This upload was cancelled. Start it again.");
      return { id: p.id, status: "pending", uploadUrl: await presignUpload(p.key, p.mime), contentType: p.mime, replaces: [] };
    }

    await sweepAbandoned(input.athleteUuid);

    const existing = await q<Row>(
      `SELECT ${COLUMNS} FROM coach.athlete_videos v JOIN analytics.d_athletes a USING (athlete_uuid) WHERE v.status = 'ready' AND v.athlete_uuid = $1`,
      input.athleteUuid,
    );
    const id = crypto.randomUUID();
    const incoming = { id, recordedDate: input.recordedDate, createdAt: new Date().toISOString().replace("T", " ") };
    const plan = planRotation(existing, incoming);
    let replaces: ReplaceInfo[] = [];
    if (plan.kind === "too_old") throw tooOld(plan.oldestRecent);
    if (plan.kind === "rotate") {
      if (!confirmedAll(plan.evict.map((e) => e.id), input.confirmReplaceIds)) throw replaceRequired(plan.evict);
      replaces = plan.evict.map(toReplace);
    }

    const key = objectKeyFor(input.athleteUuid, id, input.mime);
    await q(
      `INSERT INTO coach.athlete_videos
         (id, athlete_uuid, category, title, notes, recorded_date, filename, mime, size_bytes, object_key, status, client_key,
          replace_targets, uploaded_by, uploaded_by_name, updated_by)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, 'pending', $11::uuid, $12::uuid[], $13, $14, $13)
       RETURNING id`,
      id, input.athleteUuid, input.category, input.title, input.notes, input.recordedDate, input.filename, input.mime,
      input.size, key, input.clientKey, input.confirmReplaceIds, actor.clerkUserId, actor.name,
    );
    return { id, status: "pending", uploadUrl: await presignUpload(key, input.mime), contentType: input.mime, replaces };
  });
}

type PendingRow = { id: string; athleteUuid: string; status: string; key: string; mime: VideoMime; size: number; recordedDate: string; createdAt: string; replaceTargets: string[] };

async function abandon(row: PendingRow, actor: Actor, reason: string): Promise<void> {
  await q(
    `UPDATE coach.athlete_videos SET status = 'deleted', deleted_at = now(), deleted_by = $2, deleted_by_name = $3, delete_reason = 'abandoned', updated_at = now()
      WHERE id = $1::uuid AND status = 'pending' RETURNING id`,
    row.id, actor.clerkUserId, actor.name,
  );
  await q(`INSERT INTO coach.athlete_video_events (video_id, athlete_uuid, action, actor, actor_name, detail) VALUES ($1::uuid, $2, 'abandon', $3, $4, $5::jsonb) RETURNING id`,
    row.id, row.athleteUuid, actor.clerkUserId, actor.name, JSON.stringify({ reason }));
  await deleteObjectQuietly(row.key);
}

/** After the browser's PUT: verify the bytes, rotate if needed, publish. Idempotent. */
export async function completeUpload(id: string, actor: Actor, confirmReplaceIds: string[] = []): Promise<{ id: string; rotated: ReplaceInfo[] }> {
  return guard(async () => {
    const rows = await q<PendingRow>(
      `SELECT id::text AS id, athlete_uuid AS "athleteUuid", status, object_key AS key, mime, size_bytes::float8 AS size,
              recorded_date::text AS "recordedDate", created_at::text AS "createdAt", replace_targets::text[] AS "replaceTargets"
         FROM coach.athlete_videos WHERE id = $1::uuid`,
      id,
    );
    const row = rows[0];
    if (!row) throw new VideoError(404, "Upload not found");
    if (row.status === "ready") return { id, rotated: [] };
    if (row.status === "deleted") throw new VideoError(410, "This upload was cancelled. Start it again.");

    // The stored object must be the file the coach declared, and really a video container.
    const size = await objectSize(row.key);
    if (size == null) throw new VideoError(409, "The video didn't reach storage. Retry the upload.", "NOT_UPLOADED");
    if (size !== row.size || size > MAX_VIDEO_BYTES) {
      await abandon(row, actor, `size ${size} != declared ${row.size}`);
      throw new VideoError(400, "The uploaded file doesn't match the one selected. Please upload it again.");
    }
    if (!sniffMatches(row.mime, await objectHead(row.key))) {
      await abandon(row, actor, "signature mismatch");
      throw new VideoError(400, "That file isn't a playable MOV, MP4, or WebM video.");
    }

    const confirmed = [...row.replaceTargets.map((s) => s.toLowerCase()), ...confirmReplaceIds];
    const rotated = await prisma.$transaction(async (tx) => {
      const tq: Q = (sql, ...params) => tx.$queryRawUnsafe(sql, ...params);
      // Same lock key as the trigger in create_coach_videos.sql: one save per athlete at a time.
      await tq(`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext('coach.athlete_videos:' || $1::text))) l`, row.athleteUuid);
      const again = await tq<{ status: string }>(`SELECT status FROM coach.athlete_videos WHERE id = $1::uuid FOR UPDATE`, id);
      if (again[0]?.status === "ready") return [] as Row[];
      if (again[0]?.status !== "pending") throw new VideoError(410, "This upload was cancelled. Start it again.");
      const existing = await tq<Row>(
        `SELECT ${COLUMNS} FROM coach.athlete_videos v JOIN analytics.d_athletes a USING (athlete_uuid) WHERE v.status = 'ready' AND v.athlete_uuid = $1 FOR UPDATE OF v`,
        row.athleteUuid,
      );
      const plan = planRotation(existing, { id, recordedDate: row.recordedDate, createdAt: row.createdAt });
      if (plan.kind === "too_old") throw tooOld(plan.oldestRecent);
      const evict = plan.kind === "rotate" ? plan.evict : [];
      // Another coach saved a clip meanwhile and the one leaving changed: ask again.
      if (!confirmedAll(evict.map((e) => e.id), confirmed)) throw replaceRequired(evict);
      for (const e of evict) {
        await tq(
          `UPDATE coach.athlete_videos SET status = 'deleted', deleted_at = now(), deleted_by = $2, deleted_by_name = $3,
                  delete_reason = 'rotated', updated_at = now(), updated_by = $2 WHERE id = $1::uuid RETURNING id`,
          e.id, actor.clerkUserId, actor.name,
        );
        await tq(`INSERT INTO coach.athlete_video_events (video_id, athlete_uuid, action, actor, actor_name, detail) VALUES ($1::uuid, $2, 'rotate', $3, $4, $5::jsonb) RETURNING id`,
          e.id, row.athleteUuid, actor.clerkUserId, actor.name, JSON.stringify({ replacedBy: id }));
      }
      await tq(`UPDATE coach.athlete_videos SET status = 'ready', ready_at = now(), updated_at = now() WHERE id = $1::uuid RETURNING id`, id);
      await tq(`INSERT INTO coach.athlete_video_events (video_id, athlete_uuid, action, actor, actor_name, detail) VALUES ($1::uuid, $2, 'upload', $3, $4, $5::jsonb) RETURNING id`,
        id, row.athleteUuid, actor.clerkUserId, actor.name, JSON.stringify({ rotated: evict.map((e) => e.id) }));
      return evict;
    }, { timeout: 15_000 });

    // Files go only after the rows are committed (a failed delete leaves an unreferenced object, never a broken clip).
    for (const e of rotated) {
      const k = await q<{ key: string }>(`SELECT object_key AS key FROM coach.athlete_videos WHERE id = $1::uuid`, e.id);
      if (k[0]) await deleteObjectQuietly(k[0].key);
    }
    return { id, rotated: rotated.map(toReplace) };
  });
}

/** Abandon a pending upload the coach cancelled (or that failed in the browser). */
export async function cancelUpload(id: string, actor: Actor): Promise<void> {
  return guard(async () => {
    const rows = await q<PendingRow>(
      `SELECT id::text AS id, athlete_uuid AS "athleteUuid", status, object_key AS key, mime, size_bytes::float8 AS size,
              recorded_date::text AS "recordedDate", created_at::text AS "createdAt", replace_targets::text[] AS "replaceTargets"
         FROM coach.athlete_videos WHERE id = $1::uuid`,
      id,
    );
    if (rows[0]?.status === "pending") await abandon(rows[0], actor, "cancelled");
  });
}

async function readyRow(id: string): Promise<Row & { key: string }> {
  if (!isUuid(id)) throw new VideoError(404, "Video not found");
  const rows = await q<Row & { key: string }>(
    `SELECT ${COLUMNS}, v.object_key AS key FROM coach.athlete_videos v JOIN analytics.d_athletes a USING (athlete_uuid) WHERE v.id = $1::uuid AND v.status = 'ready'`,
    id,
  );
  if (!rows[0]) throw new VideoError(404, "Video not found");
  return rows[0];
}

export async function getVideo(id: string): Promise<Video> {
  return guard(async () => {
    const { athleteUuid } = await readyRow(id);
    const { videos } = await listForAthlete(athleteUuid);
    const video = videos.find((v) => v.id === id);
    if (!video) throw new VideoError(404, "Video not found");
    return video;
  });
}

export async function mediaUrl(id: string, download: boolean): Promise<string> {
  return guard(async () => {
    const r = await readyRow(id);
    return presignMedia(r.key, r.mime, r.filename, download);
  });
}

export async function editVideo(id: string, edit: EditInput, actor: Actor): Promise<Video> {
  return guard(async () => {
    const before = await readyRow(id);
    const sets: string[] = [];
    const params: unknown[] = [id];
    const add = (col: string, val: unknown, cast = "") => {
      params.push(val);
      sets.push(`${col} = $${params.length}${cast}`);
    };
    if (edit.title !== undefined) add("title", edit.title);
    if (edit.notes !== undefined) add("notes", edit.notes);
    if (edit.category !== undefined) add("category", edit.category);
    if (edit.recordedDate !== undefined) add("recorded_date", edit.recordedDate, "::date");
    params.push(actor.clerkUserId);
    await q(`UPDATE coach.athlete_videos SET ${sets.join(", ")}, updated_at = now(), updated_by = $${params.length} WHERE id = $1::uuid AND status = 'ready' RETURNING id`, ...params);
    const changed = Object.fromEntries(Object.keys(edit).map((k) => [k, { from: (before as Record<string, unknown>)[k], to: (edit as Record<string, unknown>)[k] }]));
    await q(`INSERT INTO coach.athlete_video_events (video_id, athlete_uuid, action, actor, actor_name, detail) VALUES ($1::uuid, $2, 'edit', $3, $4, $5::jsonb) RETURNING id`,
      id, before.athleteUuid, actor.clerkUserId, actor.name, JSON.stringify(changed));
    return getVideo(id);
  });
}

/** Deletes one clip (row soft-deleted for the audit trail, file removed). Never touches the athlete. */
export async function deleteVideo(id: string, actor: Actor): Promise<void> {
  return guard(async () => {
    const r = await readyRow(id);
    await q(
      `UPDATE coach.athlete_videos SET status = 'deleted', deleted_at = now(), deleted_by = $2, deleted_by_name = $3, delete_reason = 'coach',
              updated_at = now(), updated_by = $2 WHERE id = $1::uuid AND status = 'ready' RETURNING id`,
      id, actor.clerkUserId, actor.name,
    );
    await q(`INSERT INTO coach.athlete_video_events (video_id, athlete_uuid, action, actor, actor_name, detail) VALUES ($1::uuid, $2, 'delete', $3, $4, $5::jsonb) RETURNING id`,
      id, r.athleteUuid, actor.clerkUserId, actor.name, JSON.stringify({ title: r.title, recordedDate: r.recordedDate }));
    await deleteObjectQuietly(r.key);
  });
}
