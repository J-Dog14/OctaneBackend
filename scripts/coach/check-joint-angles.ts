/**
 * Checks the rebuilt joint angles (lib/coach/biomech/segAt.ts) against Visual3D on stored trials.
 *
 *   npm run biomech:check-angles                      # every trial with events + segment rotations
 *   npm run biomech:check-angles -- --athlete "Garrett Cleavinger"
 *
 * Per trial and joint, the sign convention is calibrated on foot contact, MER and release, then the
 * angles are rebuilt at release + 100 ms and compared with V3D's own Release100msAfter values,
 * which the calibration never saw. Prints a summary by throwing hand and joint. Read-only.
 */

import "../pitch-intel/env";
import { prisma } from "../../lib/db/prisma";
import { TrialLookup } from "../../lib/coach/biomech/extract";
import { COMPUTED_JOINTS, computeSegAt, type Query } from "../../lib/coach/biomech/segAt";
import { MATCH_TOL_DEG } from "../../lib/coach/biomech/jointAngles";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};

type Row = {
  athlete_uuid: string;
  name: string | null;
  session_date: string;
  pitch_category: string;
  trial_index: number;
  events: Record<string, unknown> | null;
  frame_rate: number | null;
  handedness: string | null;
  m: Record<string, unknown> | null;
};

async function main() {
  const who = arg("--athlete");
  const query: Query = (sql, ...params) => prisma.$queryRawUnsafe(sql, ...params);
  const vars = COMPUTED_JOINTS.flatMap((j) => ["Footstrike", "Foot_Contact", "Max_Shoulder_Rot", "Release", "Release100msAfter"].map((e) => `${j}@${e}`));
  const rows = await query<Row>(
    `SELECT t.athlete_uuid, a.name, t.session_date::text AS session_date, t.pitch_category, t.trial_index,
            to_jsonb(t) -> 'events' AS events, td.frame_rate::float8 AS frame_rate, td.handedness,
            (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(t.metrics::jsonb) e
              WHERE split_part(e.key, '.', 2) = ANY($1::text[])) AS m
       FROM public.f_pitching_trials t
       JOIN analytics.d_athletes a ON a.athlete_uuid = t.athlete_uuid
       LEFT JOIN public.f_pitching_time_data td
              ON td.athlete_uuid = t.athlete_uuid AND td.session_date = t.session_date
             AND td.pitch_category = t.pitch_category AND td.trial_index = t.trial_index
      WHERE ($2::text IS NULL OR a.name ILIKE '%' || $2 || '%' OR t.athlete_uuid = $2)
      ORDER BY t.athlete_uuid, t.session_date, t.pitch_category, t.trial_index`,
    vars,
    who,
  );
  if (!rows.length) {
    console.log("No trials found.");
    return;
  }

  // hand → joint → stats
  type Stat = { trials: number; calibrated: number; heldOut: number; heldOutOk: number; worst: number };
  const stats = new Map<string, Map<string, Stat>>();
  const skipped = new Map<string, number>();
  const bad: string[] = [];

  const sessions = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.athlete_uuid}|${r.session_date}`;
    if (!sessions.has(k)) sessions.set(k, []);
    sessions.get(k)!.push(r);
  }
  let done = 0;
  for (const list of sessions.values()) {
    const first = list[0]!;
    const lookups = list.map((r) => new TrialLookup(r.m ?? {}));
    const res = await computeSegAt(
      query,
      first.athlete_uuid,
      first.session_date,
      list.map((r, i) => ({
        category: r.pitch_category,
        trialIndex: r.trial_index,
        events: r.events,
        frameRate: r.frame_rate,
        hand: (r.handedness ?? "").toUpperCase().startsWith("L") ? "L" : "R",
        lookup: lookups[i]!,
      })),
      100,
    );
    list.forEach((r, i) => {
      const hand = (r.handedness ?? "?").toUpperCase().startsWith("L") ? "Left" : (r.handedness ? "Right" : "?");
      const out = res.get(`${r.pitch_category}:${r.trial_index}`);
      if (!out || out.skipped) {
        const why = out?.skipped ?? "not computed";
        skipped.set(why, (skipped.get(why) ?? 0) + 1);
        return;
      }
      if (!stats.has(hand)) stats.set(hand, new Map());
      for (const j of COMPUTED_JOINTS) {
        const h = stats.get(hand)!;
        if (!h.has(j)) h.set(j, { trials: 0, calibrated: 0, heldOut: 0, heldOutOk: 0, worst: 0 });
        const s = h.get(j)!;
        s.trials++;
        const cal = out.calErrDeg[j];
        const ang = out.angles[j];
        if (ang) s.calibrated++;
        else if (cal != null && bad.length < 15) bad.push(`${r.name ?? r.athlete_uuid} ${r.session_date} ${r.pitch_category} #${r.trial_index} ${j}: best calibration off by ${cal.toFixed(1)}°`);
        const v3d = (["X", "Y", "Z"] as const).map((a) => lookups[i]!.get(`${j}@Release100msAfter_${a}`));
        if (ang && v3d.every((x) => x != null)) {
          s.heldOut++;
          const e = Math.max(...ang.map((v, k) => Math.abs(((((v - v3d[k]! + 180) % 360) + 360) % 360) - 180)));
          s.worst = Math.max(s.worst, e);
          if (e <= MATCH_TOL_DEG) s.heldOutOk++;
          else if (bad.length < 15) bad.push(`${r.name ?? r.athlete_uuid} ${r.session_date} ${r.pitch_category} #${r.trial_index} ${j}: +100 ms off by ${e.toFixed(2)}°`);
        }
      }
    });
    done += list.length;
    process.stdout.write(`\r  checked ${done}/${rows.length} trials`);
  }
  console.log("\n");
  for (const [hand, h] of stats) {
    console.log(`${hand}-handed`);
    for (const [j, s] of h) {
      console.log(
        `  ${j.padEnd(26)} reproduced V3D on ${s.calibrated}/${s.trials} trials · +100 ms held-out check ${s.heldOutOk}/${s.heldOut} within ${MATCH_TOL_DEG}° (worst ${s.worst.toFixed(3)}°)`,
      );
    }
  }
  if (skipped.size) console.log(`\nSkipped: ${[...skipped].map(([k, v]) => `${v} × ${k}`).join(", ")}`);
  if (bad.length) console.log(`\nFirst misses:\n  ${bad.join("\n  ")}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
