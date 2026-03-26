import { S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/db/prisma";

let _client: S3Client | null = null;
let _bucket: string | null = null;

async function getR2Settings() {
  const rows = await prisma.orgSetting.findMany({
    where: { key: { in: ["r2_account_id", "r2_access_key_id", "r2_secret_access_key", "r2_bucket_name"] } },
  });
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
}

/** Returns an S3Client configured for Cloudflare R2. Lazy-initialized. */
export async function getR2Client(): Promise<S3Client> {
  if (_client) return _client;

  const dbSettings = await getR2Settings();

  const accountId = dbSettings["r2_account_id"] ?? process.env.R2_ACCOUNT_ID;
  const accessKeyId = dbSettings["r2_access_key_id"] ?? process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = dbSettings["r2_secret_access_key"] ?? process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 not configured. Set R2 Account ID, Access Key ID, and Secret Access Key in Settings.");
  }

  _client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    requestHandler: { requestTimeout: 15_000 }, // 15 s — prevents hanging uploads from stalling the stream
  });

  return _client;
}

export async function getR2Bucket(): Promise<string> {
  if (_bucket) return _bucket;

  const dbSettings = await getR2Settings();
  _bucket = dbSettings["r2_bucket_name"] ?? process.env.R2_BUCKET_NAME ?? null;

  if (!_bucket) throw new Error("R2 Bucket Name not configured. Set it in Settings.");
  return _bucket;
}
