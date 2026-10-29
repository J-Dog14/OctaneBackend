/**
 * Let the coach pages upload straight to R2 (Video Hub). Browsers PUT the file to a
 * presigned URL, which needs a CORS rule on the bucket for the app's origin(s).
 *
 *   npm run videos:cors -- https://your-app.up.railway.app http://localhost:3000
 *   npm run videos:cors -- --show            print the bucket's current rules
 *
 * Needs an R2 token that can edit bucket settings (Admin Read & Write). If your token
 * can't, paste the JSON this prints into Cloudflare → R2 → bucket → Settings → CORS Policy.
 * Existing rules for other origins are kept.
 */
import "../pitch-intel/env";
import { GetBucketCorsCommand, PutBucketCorsCommand, type CORSRule } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/db/prisma";
import { getR2Bucket, getR2Client } from "@/lib/r2/client";

async function main() {
  const args = process.argv.slice(2);
  const client = await getR2Client();
  const Bucket = await getR2Bucket();
  const current: CORSRule[] = await client
    .send(new GetBucketCorsCommand({ Bucket }))
    .then((r) => r.CORSRules ?? [])
    .catch(() => []);
  if (args.includes("--show") || !args.length) {
    console.log(JSON.stringify(current, null, 2));
    if (!args.length) console.log("\nPass the app origin(s) to add the Video Hub rule, e.g. npm run videos:cors -- https://app.example.com");
    return;
  }
  const origins = args.map((o) => new URL(o).origin);
  const rule: CORSRule = {
    ID: "video-hub-uploads",
    AllowedOrigins: origins,
    AllowedMethods: ["PUT", "GET", "HEAD"],
    AllowedHeaders: ["content-type"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  };
  const rules = [...current.filter((r) => r.ID !== rule.ID), rule];
  console.log("Rules to apply:\n" + JSON.stringify(rules, null, 2));
  await client.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: rules } }));
  console.log(`\nCORS updated on ${Bucket}.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    console.error("If this is an access error, add the rule above in the Cloudflare dashboard instead.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
