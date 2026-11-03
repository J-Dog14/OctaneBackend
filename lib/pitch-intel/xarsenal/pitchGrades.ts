/**
 * xArsenal v3 + 8-Stuff+ for every single TrackMan pitch (server-only), stored in
 * pitch_intel.trackman_pitch_grades.
 *
 * - Only pitches with the full TrackMan read are graded: velo, spin, IVB, HB, extension,
 *   VAA, release height and release side (spin efficiency is sent when TrackMan has it).
 *   Velo-only / partial reads are left ungraded on purpose.
 * - Each pitch is sent to Ryan's Worker as its own item, together with that session's
 *   averages of the athlete's OTHER pitch types, so arsenal-relative rules (e.g. a
 *   changeup's velo gap to the fastball) still have a reference. Only the pitch's own
 *   grade is kept.
 * - `inputs_hash` covers everything sent; a pitch is re-graded only when it changes
 *   (re-tagged type, new level or hand, new session context) or with `force`.
 *
 * Called after app uploads (commitTrackman), by `npm run pi:grade` (nightly and backfill),
 * and lazily by the coach suite's Mechanics + Flight view for the session it shows.
 */

import { createHash } from "node:crypto";
import { getDb } from "../db";
import { gradeArsenals, xaLevel, type XaItemIn, type XaPitchIn } from "./worker";

type Row = {
  pitch_uid: string;
  athlete_uuid: string;
  session_date: string;
  pitch_type: string;
  pitcher_throws: string | null;
  rel_speed: number;
  spin_rate: number;
  ivb: number;
  hb: number;
  extension: number;
  vaa: number;
  rel_height: number;
  rel_side: number;
  spin_efficiency: number | null;
  inputs_hash: string | null;
};

const COMPLETE = `p.pitch_type <> 'OTHER' AND p.rel_speed IS NOT NULL AND p.spin_rate IS NOT NULL AND p.ivb IS NOT NULL
  AND p.hb IS NOT NULL AND p.extension IS NOT NULL AND p.vaa IS NOT NULL AND p.rel_height IS NOT NULL AND p.rel_side IS NOT NULL`;

export interface GradeRunResult {
  /** Complete pitches in scope. */
  complete: number;
  /** Pitches in scope missing part of the TrackMan read (not graded). */
  incomplete: number;
  /** Pitches sent to the Worker this run (new or changed inputs). */
  sent: number;
  /** Of those, how many came back with a score. */
  graded: number;
  error: string | null;
}

export interface GradeOptions {
  athleteUuids?: string[];
  sessionDate?: string | null;
  force?: boolean;
  /** Items per Worker call. */
  batchSize?: number;
  /** Pause between Worker calls, ms (keeps a big backfill under the Worker's rate limit). */
  pauseMs?: number;
  log?: (line: string) => void;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

function pitchIn(key: string, code: string, count: number, xs: Row[]): XaPitchIn {
  const avg = (f: (r: Row) => number | null) => {
    const v = xs.map(f).filter((x): x is number => x != null && Number.isFinite(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const eff = avg((r) => (r.spin_efficiency == null ? null : Number(r.spin_efficiency)));
  return {
    key,
    code,
    count,
    velocity: r1(avg((r) => Number(r.rel_speed))!),
    spinRate: Math.round(avg((r) => Number(r.spin_rate))!),
    ivb: r1(avg((r) => Number(r.ivb))!),
    // TrackMan HB and release side are pitcher's-right-positive, as the Worker wants (it mirrors lefties itself).
    hb: r1(avg((r) => Number(r.hb))!),
    extension: r2(avg((r) => Number(r.extension))!),
    vaa: r2(avg((r) => Number(r.vaa))!),
    releaseHeight: r2(avg((r) => Number(r.rel_height))!),
    releaseSide: r2(avg((r) => Number(r.rel_side))!),
    spinEfficiency: eff == null ? null : Math.round(eff),
  };
}

const RETRIES = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function gradeTrackmanPitches(opts: GradeOptions = {}): Promise<GradeRunResult> {
  const conn = await getDb();
  const log = opts.log ?? (() => {});
  const uuids = opts.athleteUuids?.length ? opts.athleteUuids : null;
  const date = opts.sessionDate ?? null;
  const scope = `($1::text[] IS NULL OR p.athlete_uuid = ANY($1::text[])) AND ($2::date IS NULL OR p.session_date = $2::date)`;

  const counts = await conn.query<{ complete: number; incomplete: number }>(
    `SELECT count(*) FILTER (WHERE ${COMPLETE})::int AS complete, count(*) FILTER (WHERE NOT (${COMPLETE}))::int AS incomplete
       FROM pitch_intel.trackman_pitches p WHERE ${scope}`,
    uuids,
    date,
  );
  const { complete, incomplete } = counts[0] ?? { complete: 0, incomplete: 0 };
  if (!complete) return { complete, incomplete, sent: 0, graded: 0, error: null };

  // Every complete pitch in the sessions touched (session context needs the whole session).
  const rows = await conn.query<Row>(
    `SELECT p.pitch_uid, p.athlete_uuid, p.session_date::text AS session_date, p.pitch_type, p.pitcher_throws,
            p.rel_speed::float8 AS rel_speed, p.spin_rate::float8 AS spin_rate, p.ivb::float8 AS ivb, p.hb::float8 AS hb,
            p.extension::float8 AS extension, p.vaa::float8 AS vaa, p.rel_height::float8 AS rel_height,
            p.rel_side::float8 AS rel_side, p.spin_efficiency::float8 AS spin_efficiency, g.inputs_hash
       FROM pitch_intel.trackman_pitches p
       LEFT JOIN pitch_intel.trackman_pitch_grades g ON g.pitch_uid = p.pitch_uid
      WHERE ${scope} AND ${COMPLETE}
      ORDER BY p.athlete_uuid, p.session_date, p.pitch_no NULLS LAST`,
    uuids,
    date,
  );

  const athletes = [...new Set(rows.map((r) => r.athlete_uuid))];
  const links = await conn.query<{ athlete_uuid: string; source: string; throws: string | null; level: string | null; league: string | null }>(
    `SELECT athlete_uuid, source, throws, level, league FROM pitch_intel.athlete_source_links
      WHERE athlete_uuid = ANY($1::text[]) ORDER BY (source = 'savant') DESC, id`,
    athletes,
  );
  const athleteInfo = new Map<string, { throws: string | null; level: string | null }>();
  for (const a of athletes) {
    const ls = links.filter((l) => l.athlete_uuid === a);
    const savant = ls.find((l) => l.source === "savant");
    athleteInfo.set(a, {
      throws: ls.find((l) => l.throws)?.throws ?? null,
      level: savant?.league || savant?.level || ls.find((l) => l.level)?.level || null,
    });
  }

  // Build one item per pitch.
  const bySession = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.athlete_uuid}|${r.session_date}`;
    if (!bySession.has(k)) bySession.set(k, []);
    bySession.get(k)!.push(r);
  }
  type Todo = { row: Row; item: XaItemIn; hash: string };
  const todo: Todo[] = [];
  for (const list of bySession.values()) {
    const first = list[0]!;
    const info = athleteInfo.get(first.athlete_uuid)!;
    const handRaw = (first.pitcher_throws ?? info.throws ?? "R").toUpperCase();
    const hand: "R" | "L" = handRaw.startsWith("L") ? "L" : "R";
    const level = xaLevel(info.level);
    const types = [...new Set(list.map((r) => r.pitch_type))];
    const context = new Map(types.map((c) => {
      const xs = list.filter((r) => r.pitch_type === c);
      return [c, pitchIn(`ctx:${c}`, c, xs.length, xs)];
    }));
    for (const row of list) {
      if (opts.sessionDate && row.session_date !== opts.sessionDate) continue;
      const pitches = [pitchIn(row.pitch_uid, row.pitch_type, 1, [row]), ...types.filter((c) => c !== row.pitch_type).map((c) => context.get(c)!)];
      const item: XaItemIn = { id: row.pitch_uid, hand, level, pitches };
      const hash = createHash("sha1").update(JSON.stringify([hand, level, pitches])).digest("hex");
      if (!opts.force && row.inputs_hash === hash) continue;
      todo.push({ row, item, hash });
    }
  }
  if (!todo.length) return { complete, incomplete, sent: 0, graded: 0, error: null };

  const batch = Math.max(1, opts.batchSize ?? 40);
  const pauseMs = Math.max(0, opts.pauseMs ?? 250);
  let graded = 0;
  let sent = 0;
  for (let i = 0; i < todo.length; i += batch) {
    const chunk = todo.slice(i, i + batch);
    if (i > 0 && pauseMs > 0) await sleep(pauseMs);
    let res: Awaited<ReturnType<typeof gradeArsenals>> | null = null;
    // The Worker answers 503/429 when it's busy or rate-limited: back off and retry the same batch
    // (5 s, 10 s, 20 s, 40 s, 80 s) before giving up. Anything already stored is kept either way,
    // and a re-run picks up where this one stopped.
    for (let attempt = 0; ; attempt++) {
      try {
        res = await gradeArsenals(chunk.map((t) => t.item));
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const transient = /HTTP (429|5\d\d)\b|timed out|fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg);
        if (!transient || attempt >= RETRIES) {
          log(`xArsenal service failed after ${sent} pitches: ${msg}`);
          return { complete, incomplete, sent, graded, error: msg };
        }
        const wait = 5000 * 2 ** attempt;
        log(`  ${msg}; retrying in ${wait / 1000} s (${attempt + 1}/${RETRIES})`);
        await sleep(wait);
      }
    }
    const records = chunk.map((t) => {
      const g = res.get(t.row.pitch_uid)?.pitches.get(t.row.pitch_uid) ?? null;
      if (g) graded++;
      return {
        pitch_uid: t.row.pitch_uid,
        inputs_hash: t.hash,
        hand: t.item.hand,
        level: t.item.level,
        score: g?.score ?? null,
        label: g?.label || null,
        subtype: g?.subtype || null,
        subtype_mix: g?.subtypeMix ?? null,
        stuff_plus: g?.stuffPlus ?? null,
        stuff_plus_type: g?.stuffPlusType ?? null,
        levers: g?.levers?.length ? g.levers : null,
      };
    });
    await conn.exec(
      `INSERT INTO pitch_intel.trackman_pitch_grades
              (pitch_uid, inputs_hash, hand, level, score, label, subtype, subtype_mix, stuff_plus, stuff_plus_type, levers, graded_at)
       SELECT r.pitch_uid, r.inputs_hash, r.hand, r.level, r.score, r.label, r.subtype, r.subtype_mix, r.stuff_plus, r.stuff_plus_type, r.levers, NOW()
         FROM jsonb_to_recordset($1::jsonb) AS r(pitch_uid text, inputs_hash text, hand text, level text, score int, label text, subtype text,
                                                 subtype_mix jsonb, stuff_plus float8, stuff_plus_type float8, levers jsonb)
       ON CONFLICT (pitch_uid) DO UPDATE SET
              inputs_hash = EXCLUDED.inputs_hash, hand = EXCLUDED.hand, level = EXCLUDED.level, score = EXCLUDED.score,
              label = EXCLUDED.label, subtype = EXCLUDED.subtype, subtype_mix = EXCLUDED.subtype_mix,
              stuff_plus = EXCLUDED.stuff_plus, stuff_plus_type = EXCLUDED.stuff_plus_type, levers = EXCLUDED.levers,
              graded_at = NOW()`,
      JSON.stringify(records),
    );
    sent += chunk.length;
    log(`  graded ${Math.min(i + batch, todo.length)}/${todo.length}`);
  }
  return { complete, incomplete, sent, graded, error: null };
}
