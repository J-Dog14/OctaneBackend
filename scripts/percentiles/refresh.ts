import "../pitch-intel/env";
import { prisma } from "@/lib/db/prisma";
import { runPopulationRefreshes } from "@/lib/percentiles/worker";
import { populationStatus } from "@/lib/percentiles/populations";

// Drain once. The application worker continues handling new imports afterward.
async function main() {
  const result = await runPopulationRefreshes({ maxJobs: 40, maxDurationMs: 900_000 });
  const { ready, pending, failed } = await populationStatus();
  console.log(JSON.stringify({ ...result, ready, pending, failedPopulations: failed }));
  if (result.failed || failed) process.exitCode = 1;
}

main().catch(() => {
  console.error("Population refresh failed. Check database connectivity and migration setup.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
