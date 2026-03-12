import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { getR2Client, getR2Bucket } from "./client";

/** Upload a file buffer to R2. Returns the object key. */
export async function uploadToR2(
  buffer: Buffer,
  filename: string,
  assessmentType: string,
  contentType = "application/octet-stream"
): Promise<string> {
  const client = getR2Client();
  const bucket = getR2Bucket();
  const timestamp = Date.now();
  const uuid = crypto.randomUUID();
  const key = `uploads/${assessmentType}/${timestamp}-${uuid}/${filename}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ContentLength: buffer.length,
    })
  );

  return key;
}

/** Delete an object from R2 by key. */
export async function deleteFromR2(key: string): Promise<void> {
  const client = getR2Client();
  const bucket = getR2Bucket();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Download R2 object to a local directory. Returns the local file path. */
export async function downloadFromR2ToDir(key: string, destDir: string): Promise<string> {
  const client = getR2Client();
  const bucket = getR2Bucket();

  await mkdir(destDir, { recursive: true });

  const filename = path.basename(key);
  const destPath = path.join(destDir, filename);

  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`Empty body for R2 key: ${key}`);

  await new Promise<void>((resolve, reject) => {
    const writeStream = createWriteStream(destPath);
    (response.Body as Readable).pipe(writeStream);
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });

  return destPath;
}

/** Generate a presigned GET URL for a file (for viewing/downloading results). */
export async function getPresignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  const client = getR2Client();
  const bucket = getR2Bucket();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expiresInSeconds }
  );
}
