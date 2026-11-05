/**
 * xArsenal extras for the coach suite's Pitching tab (Ryan's handoff, Nov 4 2026):
 *
 * - gradeScenario: the "Add Pitches" sandbox (handoff 06). Grades a snapshot's arsenal with
 *   hypothetical pitches added and / or current ones dropped. Shape only; nothing is saved.
 * - gradeTrend: xArsenal by outing (handoff 05 §10): every Savant game graded on its own
 *   (5+ pitches of a type, any share, one batch call) plus the Trackman sessions' grades.
 *
 * Both go through the same Worker client and caches as the rest of the tab.
 */

import { getDb } from "@/lib/pitch-intel/db";
import { isPitchCode, PITCH_LABELS } from "@/lib/pitch-intel/pitch-types";
import { SESSION_GRADE_MIN, workerPitches, type PitchTypeSummary } from "@/lib/pitch-intel/sessions";
import { gradeArsenals, xaLevel, type ArsenalGrade, type PitchGrade, type XaGraded, type XaPitchIn } from "@/lib/pitch-intel/xarsenal/worker";
import { SEASON_GRADE_MIN, SEASON_GRADE_MIN_SHARE, type CoachPitching } from "./pitching";

/** Codes the sandbox can add (Ryan's AP_CODES). */
export const SCENARIO_CODES = ["FF", "SI", "FC", "SL", "ST", "CU", "KC", "CH", "FS"] as const;
export const SCENARIO_MAX_ADDS = 3;

export interface ScenarioAdd {
  code: (typeof SCENARIO_CODES)[number];
  velo: number;
  ivb: number;
  /** HB in ARM-SIDE convention (+ arm, − glove), inches. */
  arm: number;
  spin?: number | null;
  vaa?: number | null;
  /** Share of the new arsenal, % (default 12). */
  usage?: number | null;
}

export interface ScenarioRequest {
  /** Snapshot key from the Arsenal view: season:YYYY · tm:DATE:TYPE · rep:ID */
  snapshot: string;
  adds: ScenarioAdd[];
  drop: string[];
}

export interface GradedOut {
  arsenal: ArsenalGrade | null;
  pitches: Record<string, PitchGrade>;
}

export interface ScenarioResult {
  now: GradedOut;
  scenario: GradedOut;
  /** Worker keys of the added pitches (e.g. "CH_new1"), in request order. */
  addedKeys: string[];
  /** Added pitches the Worker didn't grade. */
  ungraded: string[];
  dropped: string[];
}

export class ScenarioError extends Error {}

const out = (g: XaGraded | undefined): GradedOut => ({ arsenal: g?.arsenal ?? null, pitches: Object.fromEntries(g?.pitches ?? []) });

interface Snap {
  rows: PitchTypeSummary[];
  level: string | null;
  minCount: number;
  minShare?: number;
}

function resolveSnapshot(d: CoachPitching, key: string): Snap | null {
  const level = d.athlete.level;
  const [kind, a, b] = key.split(":");
  if (kind === "season") {
    const s = d.seasons.find((x) => String(x.season) === a);
    return s ? { rows: s.byType, level, minCount: SEASON_GRADE_MIN, minShare: SEASON_GRADE_MIN_SHARE } : null;
  }
  if (kind === "tm") {
    const s = d.sessions.find((x) => x.date === a && x.sessionType === b);
    return s ? { rows: s.byType, level, minCount: SESSION_GRADE_MIN } : null;
  }
  if (kind === "rep") {
    const r = d.reports.find((x) => String(x.id) === a);
    return r ? { rows: r.byType, level: r.level || level, minCount: 0 } : null;
  }
  return null;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const r2 = (v: number) => Math.round(v * 100) / 100;

export function parseScenario(body: unknown): ScenarioRequest {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof o.snapshot !== "string" || !o.snapshot) throw new ScenarioError("Pick an arsenal to start from.");
  const adds = (Array.isArray(o.adds) ? o.adds : []).slice(0, SCENARIO_MAX_ADDS).map((x) => {
    const a = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const code = String(a.code ?? "");
    if (!(SCENARIO_CODES as readonly string[]).includes(code)) throw new ScenarioError(`Unknown pitch type "${code}".`);
    const n = (v: unknown) => (v === "" || v == null ? null : Number(v));
    const add: ScenarioAdd = { code: code as ScenarioAdd["code"], velo: Number(a.velo), ivb: Number(a.ivb), arm: Number(a.arm), spin: n(a.spin), vaa: n(a.vaa), usage: n(a.usage) };
    if (!finite(add.velo) || !finite(add.ivb) || !finite(add.arm)) throw new ScenarioError("Needs velo, IVB and HB to grade.");
    if (add.velo < 50 || add.velo > 105) throw new ScenarioError("Velo should be between 50 and 105 mph.");
    return add;
  });
  const drop = (Array.isArray(o.drop) ? o.drop : []).map(String);
  if (!adds.length && !drop.length) throw new ScenarioError("Fill in at least one new pitch, or uncheck a current pitch to test dropping it.");
  return { snapshot: o.snapshot, adds, drop };
}

/** Ryan's apScenario: new pitches released from the current slot, counts sized to their usage. */
export async function gradeScenario(d: CoachPitching, req: ScenarioRequest): Promise<ScenarioResult> {
  const snap = resolveSnapshot(d, req.snapshot);
  if (!snap) throw new ScenarioError("That arsenal isn't available any more. Reload the tab.");
  const throws = d.athlete.throws;
  const lefty = throws === "L";
  const base = workerPitches({ rows: snap.rows, throws, minCount: snap.minCount, minShare: snap.minShare });
  if (!base.length) throw new ScenarioError("Not enough pitch data in this arsenal to grade.");

  // Slot every new pitch is released from: count-weighted means over the current pitches.
  const slotOf = (k: "extension" | "armAngle" | "releaseHeight" | "releaseSide") => {
    let s = 0;
    let w = 0;
    for (const p of base) {
      const v = p[k];
      if (!finite(v)) continue;
      const c = p.count ?? 1;
      s += v * c;
      w += c;
    }
    return w ? r2(s / w) : null;
  };
  const slot = { extension: slotOf("extension"), armAngle: slotOf("armAngle"), releaseHeight: slotOf("releaseHeight"), releaseSide: slotOf("releaseSide") };

  const drop = new Set(req.drop);
  const keep = base.filter((p) => !drop.has(p.key));
  if (!keep.length && !req.adds.length) throw new ScenarioError("Keep at least one pitch in the arsenal.");
  const total = keep.reduce((t, p) => t + (p.count ?? 0), 0) || 100;
  const sumU = req.adds.reduce((t, a) => t + Math.max(0, a.usage ?? 12), 0);
  const denom = Math.max(10, 100 - Math.min(sumU, 90));
  const added: XaPitchIn[] = req.adds.map((a, i) => ({
    key: `${a.code}_new${i + 1}`,
    code: a.code,
    count: Math.max(1, Math.round((total * Math.max(1, a.usage ?? 12)) / denom)),
    velocity: a.velo,
    spinRate: a.spin ?? null,
    ivb: a.ivb,
    // arm-side → the Worker's right-handed convention
    hb: r2(a.arm * (lefty ? -1 : 1)),
    extension: slot.extension,
    vaa: a.vaa ?? null,
    armAngle: slot.armAngle,
    releaseHeight: slot.releaseHeight,
    releaseSide: slot.releaseSide,
  }));
  const pitches = [...keep, ...added];
  if (!pitches.length) throw new ScenarioError("Keep at least one pitch in the arsenal.");

  const hand = (throws ?? "R") as "R" | "L";
  const level = xaLevel(snap.level);
  const graded = await gradeArsenals([
    { id: "now", hand, level, pitches: base },
    { id: "scenario", hand, level, pitches },
  ]);
  const scenario = graded.get("scenario");
  return {
    now: out(graded.get("now")),
    scenario: out(scenario),
    addedKeys: added.map((p) => p.key),
    ungraded: added.filter((p) => !scenario?.pitches.has(p.key)).map((p) => p.key),
    dropped: [...drop].filter((k) => base.some((p) => p.key === k)),
  };
}

// ---------------------------------------------------------------------------
// Grade by outing
// ---------------------------------------------------------------------------

export interface TrendPoint {
  date: string;
  source: "savant" | "trackman";
  label: string;
  arsenal: number | null;
  /** Pitch code → score. */
  pitches: Record<string, number>;
}

export interface GradeTrend {
  points: TrendPoint[];
  error: string | null;
}

const r1 = (v: unknown) => (v == null ? null : Math.round(Number(v) * 10) / 10);
const VAA = `degrees(atan(
    (vz0 + az * ((-sqrt(greatest(vy0 * vy0 - 2 * ay * (50 - 17.0 / 12), 0)) - vy0) / nullif(ay, 0)))
    / nullif(abs(-sqrt(greatest(vy0 * vy0 - 2 * ay * (50 - 17.0 / 12), 0))), 0)))`;

/** Savant games graded one by one (Ryan's getXArsenalByOuting: 5+ pitches of a type, any share). */
export async function gradeTrend(d: CoachPitching, season: number | null): Promise<GradeTrend> {
  const points: TrendPoint[] = [];
  for (const s of d.sessions) {
    if (!s.arsenal || (season != null && Number(s.date.slice(0, 4)) !== season)) continue;
    points.push({
      date: s.date, source: "trackman", label: `Trackman ${s.sessionType}`, arsenal: s.arsenal.score,
      pitches: Object.fromEntries(s.byType.filter((t) => t.grade).map((t) => [t.pitchType, t.grade!.score])),
    });
  }
  let error: string | null = null;
  if (d.athlete.hasSavant) {
    const conn = await getDb();
    const rows = await conn.query<{
      date: string; game_pk: string; opp: string | null; pitch_type: string; n: number;
      velo: number | null; spin: number | null; ivb: number | null; hb_arm: number | null; ext: number | null;
      rel_h: number | null; rel_s: number | null; arm: number | null; vaa: number | null;
    }>(
      `SELECT game_date::text AS date, game_pk::text AS game_pk,
              max(CASE WHEN inning_topbot = 'Top' THEN away_team ELSE home_team END) AS opp,
              pitch_type, count(*)::int AS n,
              avg(release_speed) AS velo, avg(release_spin_rate) AS spin, avg(pfx_z) * 12 AS ivb,
              avg(CASE WHEN p_throws = 'L' THEN pfx_x ELSE -pfx_x END) * 12 AS hb_arm,
              avg(release_extension) AS ext, avg(release_pos_z) AS rel_h, avg(release_pos_x) AS rel_s,
              avg(arm_angle) AS arm, avg(${VAA}) AS vaa
         FROM pitch_intel.savant_pitches
        WHERE athlete_uuid = $1 AND pitch_type IS NOT NULL AND pitch_type <> ''
          AND ($2::int IS NULL OR game_year = $2::int)
        GROUP BY game_date, game_pk, pitch_type
        ORDER BY game_date, game_pk`,
      d.athlete.athleteUuid,
      season,
    );
    const games = new Map<string, { date: string; opp: string | null; rows: PitchTypeSummary[] }>();
    for (const r of rows) {
      const k = r.game_pk;
      if (!games.has(k)) games.set(k, { date: r.date, opp: r.opp, rows: [] });
      const code = isPitchCode(r.pitch_type) ? r.pitch_type : "OTHER";
      games.get(k)!.rows.push({
        pitchType: code, label: PITCH_LABELS[code], count: r.n, usagePct: null, velo: r1(r.velo), veloMax: null,
        spinRate: r.spin == null ? null : Math.round(Number(r.spin)), ivb: r1(r.ivb), hbArm: r1(r.hb_arm), extension: r1(r.ext),
        relHeight: r1(r.rel_h), relSide: r1(r.rel_s), armAngle: r1(r.arm), vaa: r1(r.vaa), spinEfficiency: null,
        whiffPct: null, swings: null, grade: null,
      });
    }
    const hand = (d.athlete.throws ?? "R") as "R" | "L";
    const level = xaLevel(d.athlete.level);
    const items = [...games.entries()].map(([id, g]) => ({ id, hand, level, pitches: workerPitches({ rows: g.rows, throws: d.athlete.throws, minCount: SESSION_GRADE_MIN }) }));
    try {
      const graded = await gradeArsenals(items);
      for (const [id, g] of games) {
        const res = graded.get(id);
        if (!res?.pitches.size) continue;
        points.push({
          date: g.date, source: "savant", label: g.opp ? `vs ${g.opp}` : "Savant game", arsenal: res.arsenal?.score ?? null,
          pitches: Object.fromEntries([...res.pitches].map(([k, p]) => [k, p.score])),
        });
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  return { points, error };
}
