const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { compile } = require("./helpers/compile-ts.cjs");

test("page readers use the saved population and never invoke the expensive builder", async () => {
  let builds = 0;
  let reads = 0;
  const { definePopulation } = compile("lib/percentiles/populations.ts", {
    "@/lib/db/prisma": { prisma: { $queryRaw: async () => { reads++; return [{ payload: { velo: [80, 90] } }]; } } },
  });
  const get = definePopulation("unit-ready", async () => { builds++; return {}; }, () => ({}));
  assert.deepEqual(await get(), { velo: [80, 90] });
  assert.deepEqual(await get(), { velo: [80, 90] });
  assert.equal(builds, 0);
  assert.equal(reads, 1);
});

test("first backfill leaves metrics available with an empty population instead of blocking", async () => {
  const { definePopulation } = compile("lib/percentiles/populations.ts", {
    "@/lib/db/prisma": { prisma: { $queryRaw: async () => [{ payload: null }] } },
  });
  const get = definePopulation("unit-empty", async () => { throw new Error("must not build on a page"); }, () => []);
  assert.deepEqual(await get(), []);
});

test("publication clears response caches only when the fencing token still owns the job", async () => {
  let ownership = 0;
  let cleared = 0;
  const worker = compile("lib/percentiles/worker.ts", {
    "@/lib/db/prisma": { prisma: { $executeRaw: async () => ownership } },
    "./populations": { invalidatePopulationRead() { cleared++; } },
    "@/lib/coach/cache": { clearCoachDataCache() { cleared++; } },
  });
  assert.equal(await worker.publishPopulation("a", "old-token", "1", {}), false);
  assert.equal(cleared, 0);
  ownership = 1;
  assert.equal(await worker.publishPopulation("a", "current-token", "1", {}), true);
  assert.equal(cleared, 2);
});

test("status exposes generations and counts without exposing population payloads", async () => {
  const { populationStatus } = compile("lib/percentiles/populations.ts", {
    "@/lib/db/prisma": { prisma: { $queryRaw: async () => [
      { key: "a", version: "1", refreshed_at: "2026-10-14", pending: true, ready: true, failed: false },
      { key: "b", version: "0", refreshed_at: null, pending: true, ready: false, failed: true },
    ] } },
  });
  const status = await populationStatus();
  assert.equal(status.pending, 2);
  assert.equal(status.ready, 1);
  assert.equal(status.failed, 1);
  assert.ok(!("payload" in status));
});

test("stored percentile populations preserve tie ranks and handle new values beyond the snapshot", () => {
  const { rankPct } = compile("lib/coach/proSup.ts", {
    "@/lib/db/prisma": { prisma: {} },
    "@/lib/percentiles/populations": { definePopulation: () => async () => [] },
  });
  assert.equal(rankPct([10, 20, 20, 30], 20), 62.5);
  assert.equal(rankPct([10, 20, 20, 30], 30), 100);
  assert.equal(rankPct([10, 20, 20, 30], 40), 100);
  assert.equal(rankPct([], 20), null);
});

test("Next production compiler accepts all athlete dynamic imports", async () => {
  const swc = require("next/dist/build/swc");
  await swc.loadBindings();
  const filename = path.resolve("app/coach/_components/AthleteView.tsx");
  const options = require("next/dist/build/swc/options").getLoaderSWCOptions({
    filename, development: false, isServer: false, appDir: path.resolve("app"),
    isPageFile: false, hasReactRefresh: false, compilerOptions: {}, jsConfig: {},
    supportedBrowsers: [], relativeFilePathFromRoot: "app/coach/_components/AthleteView.tsx",
  });
  await assert.doesNotReject(swc.transform(fs.readFileSync(filename, "utf8"), options));
});
