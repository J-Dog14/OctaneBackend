import { S3Client } from "@aws-sdk/client-s3";

let _client: S3Client | null = null;

/** Returns an S3Client configured for Cloudflare R2. Lazy-initialized. */
export function getR2Client(): S3Client {
  if (_client) return _client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.");
  }

  _client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  return _client;
}

export function getR2Bucket(): string {
  const bucket = process.env.R2_BUCKET_NAME;
if (!bucket) throw new Error("R2_BUCKET_NAME not configured.");
  return bucket;
}
