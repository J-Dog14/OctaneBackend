/**
 * Client Hub sync from the command line (same as the hub's "Sync from app" button).
 *
 *   npm run hub:setup                 create the coach.hub_* tables (safe to re-run)
 *   npm run hub:sync -- --dry-run     show who would be added / created / flagged, write nothing
 *   npm run hub:sync                  sync for real
 *
 * Run after the app snapshot is refreshed (nightly run_app_db_sync.bat, or "Sync database").
 */
import "../pitch-intel/env";
import { prisma } from "@/lib/db/prisma";
import { syncHub } from "@/lib/client-hub/appSync";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const r = await syncHub({ force: true, dryRun });
  const { preview, ...counts } = r;
  console.log(JSON.stringify(counts, null, 2));
  if (preview.create.length) console.log(`\n${dryRun ? "Would create" : "Created"} ${r.athletesCreated || preview.create.length} new athletes (source_system 'octane_app'):\n  ${preview.create.join("\n  ")}`);
  if (preview.review.length) console.log(`\nNeed linking by a coach (similar name already in the database):\n  ${preview.review.join("\n  ")}`);
  if (dryRun) console.log("\nDry run: nothing was written.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
