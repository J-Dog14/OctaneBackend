const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { compile } = require("./helpers/compile-ts.cjs");

require("@next/env").loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

// Split SQL statements without splitting function bodies or quoted strings.
function statements(sql) {
  let quote = "";
  let comment = false;
  let start = 0;
  const out = [];
  for (let i = 0; i < sql.length; i++) {
    if (comment) { if (sql[i] === "\n") comment = false; continue; }
    if (quote === "$$") { if (sql.slice(i, i + 2) === "$$") { quote = ""; i++; } continue; }
    if (quote) {
      if (sql[i] === quote) { if (sql[i + 1] === quote) i++; else quote = ""; }
      continue;
    }
    if (sql.slice(i, i + 2) === "--") { comment = true; i++; }
    else if (sql.slice(i, i + 2) === "$$") { quote = "$$"; i++; }
    else if (["'", '"'].includes(sql[i])) quote = sql[i];
    else if (sql[i] === ";") { out.push(sql.slice(start, i)); start = i + 1; }
  }
  if (sql.slice(start).trim()) out.push(sql.slice(start));
  return out.filter((s) => s.trim());
}

test("PostgreSQL triggers and refresh leases, in an isolated schema rolled back afterward", { timeout: 120_000 }, async (t) => {
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: [] });
  const schema = `coach_population_test_${randomUUID().replaceAll("-", "")}`;
  const rollback = new Error("intentional test rollback");
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA ${schema}`);
      await tx.$executeRawUnsafe(`CREATE TABLE ${schema}.d_athletes (athlete_uuid text, gender text, date_of_birth date, age float8, age_group text, height float8, weight float8)`);
      await tx.$executeRawUnsafe(`CREATE TABLE ${schema}.f_pitching_trials (athlete_uuid text, value float8 CHECK(value >= 0))`);
      const original = fs.readFileSync("prisma/migrations/20261014000000_coach_population_snapshots/migration.sql", "utf8");
      const rewrite = (s) => s.replaceAll("public.", `${schema}.`).replaceAll("analytics.", `${schema}.`);
      for (let pass = 0; pass < 2; pass++) {
        for (const statement of statements(rewrite(original))) {
          // The enclosing test transaction must retain ownership of rollback.
          if (/^\s*(?:--[^\n]*\n\s*)*(BEGIN|COMMIT)\s*$/i.test(statement)) continue;
          await tx.$executeRawUnsafe(statement);
        }
      }
      const query = (strings) => rewrite(strings.reduce((s, part, i) => s + (i ? `$${i}` : "") + part, ""));
      const db = {
        $queryRaw: (strings, ...args) => tx.$queryRawUnsafe(query(strings), ...args),
        $executeRaw: (strings, ...args) => tx.$executeRawUnsafe(query(strings), ...args),
      };
      const populations = compile("lib/percentiles/populations.ts", { "@/lib/db/prisma": { prisma: db } });
      const worker = compile("lib/percentiles/worker.ts", {
        "@/lib/db/prisma": { prisma: db }, "./populations": populations,
        "@/lib/coach/cache": { clearCoachDataCache() {} },
      });
      const key = "population-pitching";
      const row = async () => (await tx.$queryRawUnsafe(`SELECT requested_version::text AS requested, completed_version::text AS completed, payload, failure_count FROM ${schema}.coach_population_snapshots WHERE key = $1`, key))[0];
      const due = () => tx.$executeRawUnsafe(`UPDATE ${schema}.coach_population_snapshots SET next_attempt_at = now() WHERE key = $1`, key);

      await t.test("initial job publishes a saved population", async () => {
        const job = await worker.claimPopulationJob([key], "initial");
        assert.equal(job.revision, "1");
        assert.equal(await worker.publishPopulation(key, "initial", job.revision, { velo: [80] }), true);
      });
      await t.test("one bulk INSERT produces one dirty revision and readers retain the previous payload", async () => {
        await tx.$executeRawUnsafe(`INSERT INTO ${schema}.f_pitching_trials SELECT 'fixture', n FROM generate_series(1,100) n`);
        assert.equal((await row()).requested, "2");
        const get = populations.definePopulation(key, async () => { throw new Error("page must not build"); }, () => ({}));
        assert.deepEqual(await get(), { velo: [80] });
        assert.equal(await worker.claimPopulationJob([key], "too-early"), null);
      });
      await t.test("a failed import rolls back its invalidation", async () => {
        await tx.$executeRawUnsafe("SAVEPOINT failed_import");
        await assert.rejects(tx.$executeRawUnsafe(`INSERT INTO ${schema}.f_pitching_trials VALUES ('fixture', -1)`));
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT failed_import");
        assert.equal((await row()).requested, "2");
      });
      await t.test("leases prevent duplicate workers and writes during a build remain queued", async () => {
        await due();
        const job = await worker.claimPopulationJob([key], "worker-a");
        assert.equal(await worker.claimPopulationJob([key], "worker-b"), null);
        await tx.$executeRawUnsafe(`UPDATE ${schema}.f_pitching_trials SET value = value + 1`);
        assert.equal(await worker.publishPopulation(key, "worker-a", job.revision, { velo: [80, 90] }), true);
        const state = await row();
        assert.equal(state.completed, "2");
        assert.equal(state.requested, "3");
      });
      await t.test("failures retain the saved data; expired workers cannot overwrite it", async () => {
        await due();
        const job = await worker.claimPopulationJob([key], "old-worker");
        await tx.$executeRawUnsafe(`UPDATE ${schema}.coach_population_snapshots SET lease_until = now() - interval '1 second' WHERE key = $1`, key);
        await worker.claimPopulationJob([key], "replacement");
        assert.equal(await worker.publishPopulation(key, "old-worker", job.revision, { wrong: true }), false);
        await worker.failPopulation(key, "replacement", new Error("fixture failure"));
        assert.deepEqual((await row()).payload, { velo: [80, 90] });
        assert.equal((await row()).failure_count, 1);
      });
      await t.test("DELETE and demographic changes invalidate the affected cohorts", async () => {
        await tx.$executeRawUnsafe(`DELETE FROM ${schema}.f_pitching_trials`);
        assert.equal((await row()).requested, "4");
        await tx.$executeRawUnsafe(`INSERT INTO ${schema}.d_athletes (athlete_uuid,gender) VALUES ('fixture','Male')`);
        await tx.$executeRawUnsafe(`UPDATE ${schema}.d_athletes SET gender='Female'`);
        assert.equal((await row()).requested, "6");
      });
      throw rollback;
    }, { timeout: 110_000, maxWait: 10_000 }), (error) => error === rollback);
    const remaining = await prisma.$queryRawUnsafe("SELECT schema_name FROM information_schema.schemata WHERE schema_name=$1", schema);
    assert.equal(remaining.length, 0);
  } finally {
    await prisma.$disconnect();
  }
});
