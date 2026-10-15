/**
 * Read-only: writes a sample of the hitting warehouse data to sample-data/hitting/
 * so the coach Hitting report can be checked against real variable names.
 *
 *   npx tsx scripts/coach/dump-hitting-sample.ts
 *
 * Output (no athlete names — uuids only):
 *   sample-data/hitting/inventory.json   every metric key seen in f_hitting_trials (latest 40 sessions),
 *                                         how often, and the shape of its value
 *   sample-data/hitting/session.json     every trial of the most recent session with PROCESSED keys
 *   sample-data/hitting/kinematics.json  that session's f_kinematics_hitting rows
 */
import fs from "fs";
import path from "path";
import { prisma } from "../../lib/db/prisma";

const OUT = path.join(process.cwd(), "sample-data", "hitting");

function shape(v: unknown): string {
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (v && typeof v === "object") return "object";
  return typeof v;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const sessions = await prisma.$queryRawUnsafe<Array<{ athlete_uuid: string; d: string; n: number }>>(
    `SELECT athlete_uuid, session_date::text AS d, count(*)::int AS n FROM public.f_hitting_trials
      GROUP BY 1, 2 ORDER BY 2 DESC LIMIT 40`,
  );
  const inventory = new Map<string, { count: number; shapes: Set<string>; example: unknown }>();
  let processedSession: { athlete_uuid: string; d: string } | null = null;
  const kinds = { sessionData: 0, threeD: 0, other: 0 };
  for (const s of sessions) {
    const rows = await prisma.$queryRawUnsafe<Array<{ trial_index: number; metrics: Record<string, unknown> }>>(
      `SELECT trial_index, metrics FROM public.f_hitting_trials WHERE athlete_uuid = $1 AND session_date = $2::date ORDER BY trial_index`,
      s.athlete_uuid, s.d,
    );
    for (const r of rows) {
      const m = r.metrics ?? {};
      const keys = Object.keys(m);
      if (keys.some((k) => k.startsWith("PROCESSED."))) kinds.sessionData++;
      else if ("frames" in m || "segments" in m) { kinds.threeD++; continue; }
      else kinds.other++;
      for (const k of keys) {
        const e = inventory.get(k) ?? { count: 0, shapes: new Set<string>(), example: m[k] };
        e.count++;
        e.shapes.add(shape(m[k]));
        inventory.set(k, e);
      }
    }
    if (!processedSession && rows.some((r) => Object.keys(r.metrics ?? {}).some((k) => k.startsWith("PROCESSED.")))) {
      processedSession = { athlete_uuid: s.athlete_uuid, d: s.d };
      fs.writeFileSync(path.join(OUT, "session.json"), JSON.stringify({ athlete_uuid: s.athlete_uuid, session_date: s.d, trials: rows }, null, 1));
    }
  }
  const inv = [...inventory.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, e]) => ({
    key, count: e.count, shapes: [...e.shapes], example: Array.isArray(e.example) ? (e.example as unknown[]).slice(0, 6) : e.example,
  }));
  const tables = await prisma.$queryRawUnsafe<Array<{ t: string; n: number }>>(
    `SELECT 'f_hitting_trials' t, count(*)::int n FROM public.f_hitting_trials
     UNION ALL SELECT 'f_hitting_3d_trials', count(*)::int FROM public.f_hitting_3d_trials
     UNION ALL SELECT 'f_kinematics_hitting', count(*)::int FROM public.f_kinematics_hitting
     UNION ALL SELECT 'hitting athletes', count(DISTINCT athlete_uuid)::int FROM public.f_hitting_trials`,
  ).catch(() => []);
  fs.writeFileSync(path.join(OUT, "inventory.json"), JSON.stringify({ tables, rowKinds: kinds, sessionsScanned: sessions.length, keys: inv }, null, 1));
  if (processedSession) {
    const k = await prisma.$queryRawUnsafe<Array<{ metric_name: string; frame: number; value: number | null }>>(
      `SELECT metric_name, frame, value::float8 AS value FROM public.f_kinematics_hitting
        WHERE athlete_uuid = $1 AND session_date = $2::date ORDER BY metric_name, frame`,
      processedSession.athlete_uuid, processedSession.d,
    );
    fs.writeFileSync(path.join(OUT, "kinematics.json"), JSON.stringify(k, null, 1));
  }
  console.log(`Wrote ${OUT} — ${inv.length} keys, rows: ${JSON.stringify(kinds)}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
