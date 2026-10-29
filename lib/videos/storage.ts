/**
 * R2 side of the Video Hub. The browser uploads straight to R2 with a presigned PUT and
 * plays/downloads through a short-lived presigned GET, so video bytes never pass through
 * Railway. Every URL is issued only after the coach check in the route.
 */

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Bucket, getR2Client, getR2PresignClient } from "@/lib/r2/client";
import { contentDisposition, extensionFor, type VideoMime } from "./rules";

const UPLOAD_URL_TTL_S = 30 * 60;
const MEDIA_URL_TTL_S = 60 * 60;

export function objectKeyFor(athleteUuid: string, videoId: string, mime: VideoMime): string {
  return `videos/${athleteUuid}/${videoId}.${extensionFor(mime)}`;
}

/** URL the browser PUTs the file to. It must send exactly this Content-Type. */
export async function presignUpload(key: string, mime: VideoMime): Promise<string> {
  const client = await getR2PresignClient();
  const Bucket = await getR2Bucket();
  return getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: mime }), { expiresIn: UPLOAD_URL_TTL_S });
}

/** Playback (inline) or "Download original" (attachment, original filename). */
export async function presignMedia(key: string, mime: string, filename: string, download: boolean): Promise<string> {
  const client = await getR2PresignClient();
  const Bucket = await getR2Bucket();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket,
      Key: key,
      ResponseContentType: mime,
      ResponseContentDisposition: contentDisposition(download ? "attachment" : "inline", filename),
      ResponseCacheControl: "private, max-age=3600",
    }),
    { expiresIn: MEDIA_URL_TTL_S },
  );
}

/** Size of the stored object, or null when nothing was uploaded. */
export async function objectSize(key: string): Promise<number | null> {
  const client = await getR2Client();
  const Bucket = await getR2Bucket();
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
    return head.ContentLength ?? null;
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (err as Error).name === "NotFound" || (err as Error).name === "NoSuchKey") return null;
    throw err;
  }
}

/** First `n` bytes of the object, to check the file really is a video container. */
export async function objectHead(key: string, n = 16): Promise<Uint8Array> {
  const client = await getR2Client();
  const Bucket = await getR2Bucket();
  const res = await client.send(new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${n - 1}` }));
  if (!res.Body) return new Uint8Array();
  return new Uint8Array(await res.Body.transformToByteArray());
}

export async function deleteObject(key: string): Promise<void> {
  const client = await getR2Client();
  const Bucket = await getR2Bucket();
  await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
}

/** Best effort: a leftover object costs storage but never shows up (no ready row points at it). */
export async function deleteObjectQuietly(key: string): Promise<void> {
  try {
    await deleteObject(key);
  } catch (err) {
    console.error("[videos] could not delete R2 object", key, err);
  }
}
