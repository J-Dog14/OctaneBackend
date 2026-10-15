const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { PrismaClient, Prisma } = require("@prisma/client");
const { NextRequest } = require("next/server");
const { compile } = require("./helpers/compile-ts.cjs");
require("@next/env").loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

test("comparison searches filter real data before pagination, in a rolled-back test schema", { timeout: 60_000 }, async () => {
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: [] });
  const schema = `coach_compare_test_${randomUUID().replaceAll("-", "")}`;
  const rollback = new Error("intentional rollback");
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA ${schema}`);
      const flags = ["pitching", "hitting", "athletic_screen", "mobility", "proteus", "readiness_screen", "arm_action", "pro_sup"];
      await tx.$executeRawUnsafe(`CREATE TABLE ${schema}.d_athletes (
        athlete_uuid text, name text, age_group text, updated_at timestamptz,
        ${flags.map((flag) => `has_${flag}_data boolean DEFAULT false`).join(",")})`);
      const tables = ["f_pitching_trials", "f_kinematics_pitching", "f_kinematics_hitting", "f_arm_action", "f_mobility", "f_proteus", "f_pro_sup", "f_curveball_test", "f_readiness_screen", "f_athletic_screen_cmj", "f_athletic_screen_dj", "f_athletic_screen_ppu", "f_athletic_screen_slv", "trackman_pitches"];
      for (const table of tables) await tx.$executeRawUnsafe(`CREATE TABLE ${schema}.${table} (athlete_uuid text)`);
      await tx.$executeRawUnsafe(`INSERT INTO ${schema}.d_athletes (athlete_uuid,name,updated_at,has_pitching_data) VALUES
        ('stale','AAA stale flags','2026-10-14',true),
        ('three-d','Biomech only','2026-10-13',false),
        ('pitch','Pitch 100%_literal','2026-10-12',false),
        ('pitch-other','Different pitcher','2026-10-09',false),
        ('screen','DJ only','2026-10-11',false),
        ('mobility','Mobility only','2026-10-10',false)`);
      await tx.$executeRawUnsafe(`INSERT INTO ${schema}.f_pitching_trials VALUES ('three-d')`);
      await tx.$executeRawUnsafe(`INSERT INTO ${schema}.trackman_pitches VALUES ('pitch'), ('pitch-other')`);
      await tx.$executeRawUnsafe(`INSERT INTO ${schema}.f_athletic_screen_dj VALUES ('screen')`);
      await tx.$executeRawUnsafe(`INSERT INTO ${schema}.f_mobility VALUES ('mobility')`);
      const rewrite = (sql) => sql.replaceAll("public.", `${schema}.`).replaceAll("analytics.", `${schema}.`).replaceAll("pitch_intel.", `${schema}.`);
      const db = { $queryRaw: async (sql, ...values) => {
        if (Array.isArray(sql)) sql = Prisma.sql(sql, ...values);
        if (sql.text.includes("to_regclass")) return [{ name: "pitch_intel.trackman_pitches" }];
        return tx.$queryRawUnsafe(rewrite(sql.text), ...sql.values);
      } };
      const filter = compile("lib/coach/athleteSearch.ts", { "@/lib/db/prisma": { prisma: db } });
      const { GET } = compile("app/api/coach/athletes/route.ts", {
        "@/lib/db/prisma": { prisma: db },
        "@/lib/coach/access": { requireCoach: async () => null },
        "@/lib/coach/athleteSearch": filter,
      });
      async function ids(query) {
        const response = await GET(new NextRequest(`http://localhost/api/coach/athletes?${query}`));
        assert.equal(response.status, 200);
        return (await response.json()).items.map((a) => a.athleteUuid);
      }
      assert.deepEqual(await ids("scope=pitching&limit=1"), ["pitch"]);
      assert.deepEqual(await ids("scope=biomechanics"), ["three-d"]);
      assert.deepEqual(await ids("scope=all&domain=pitching"), ["three-d"]);
      assert.deepEqual(await ids("scope=assessments"), ["screen"]);
      assert.deepEqual(await ids("scope=mobility"), ["mobility"]);
      assert.deepEqual(await ids("scope=pitching&q=%25_"), ["pitch"]);
      assert.equal((await GET(new NextRequest("http://localhost/api/coach/athletes?scope=bad"))).status, 400);
      assert.equal((await GET(new NextRequest("http://localhost/api/coach/athletes?domain=bad"))).status, 400);
      throw rollback;
    }, { timeout: 50_000 }), (error) => error === rollback);
  } finally {
    await prisma.$disconnect();
  }
});
