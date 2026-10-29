/**
 * xArsenal v3 + 8-Stuff+ (Ryan, Oct 2026): graded by Ryan's 8ctane API Worker,
 * the single source every 8ctane app calls so all apps show identical grades.
 * The 8-Stuff+ model is private to the Worker, so grades can't be computed here.
 *
 *   POST {PITCH_INTEL_XARSENAL_URL}/?action=scoreArsenal
 *   body: { items: [{ id, hand, level, pitches: [...] }] }  →  { results: [{ id, ...grades }] }
 *
 * Only pitch averages go out (no names: ids are opaque keys). Results are cached
 * in memory for 6 h per identical request. Spec: "xArsenal v3 + 8-Stuff+ — Grading Rules".
 *
 * Replaces lib/pitch-intel/xarsenal/score.ts + octane-engine.ts (the old v2 rules),
 * which nothing imports any more.
 */

export const DEFAULT_XARSENAL_URL = "https://8ctane-api.ryan-77b.workers.dev";
const TIMEOUT_MS = 20_000;

export function xarsenalUrl(): string {
  return (process.env.PITCH_INTEL_XARSENAL_URL || DEFAULT_XARSENAL_URL).replace(/\/+$/, "");
}

/** v3 levels. MiLB, Indy, Summer ball, blank and anything else grade as MLB. */
export type XaLevel = "MLB" | "College" | "High School" | "Youth";
export function xaLevel(level: string | null | undefined): XaLevel {
  const s = (level ?? "").trim();
  if (/college|ncaa|naia|juco|\bd[123]\b/i.test(s)) return "College";
  if (/high school|\bhs\b/i.test(s)) return "High School";
  if (/youth|\b1[0-4]u\b/i.test(s)) return "Youth";
  return "MLB";
}

/** One pitch type's averages, as the Worker takes them (HB: + = toward the pitcher's right; lefties as measured). */
export interface XaPitchIn {
  key: string;
  code: string;
  velocity: number;
  ivb: number;
  hb: number;
  count?: number | null;
  spinRate?: number | null;
  extension?: number | null;
  vaa?: number | null;
  armAngle?: number | null;
  releaseHeight?: number | null;
  releaseSide?: number | null;
  spinEfficiency?: number | null;
}

export interface XaItemIn {
  id: string;
  hand: "R" | "L";
  level: XaLevel;
  pitches: XaPitchIn[];
}

export interface XaLever {
  metric: string;
  points: number | null;
  text: string | null;
}

export interface PitchGrade {
  /** xArsenal 20-80 (50 = MLB average for that shape). */
  score: number;
  label: string;
  subtype: string;
  /** Shapes the grade blends, e.g. { "4S Standard": 0.7, "4S Ride-Run": 0.3 }. */
  subtypeMix: Record<string, number> | null;
  /** 8-Stuff+ (100 = average MLB pitch) and vs. its own type. */
  stuffPlus: number | null;
  stuffPlusType: number | null;
  levers: XaLever[];
}

export interface ArsenalMove {
  kind: "add" | "drop" | "rework" | string;
  title: string;
  detail: string | null;
}

export interface ArsenalGrade {
  score: number;
  label: string;
  stuffPlus: number | null;
  fit: number | null;
  /** Level the Worker graded at (as sent). */
  compLevel: XaLevel;
  slot: { angle: number | null; source: string | null; label: string | null } | null;
  moves: ArsenalMove[];
}

export interface XaGraded {
  arsenal: ArsenalGrade | null;
  pitches: Map<string, PitchGrade>;
}

// ---------------------------------------------------------------------------
// Response parsing (tolerant: the Worker owns the shape)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number | null => {
  if (isObj(v)) return num(v.score ?? v.value);
  return v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
};
const str = (...vs: unknown[]): string | null => {
  for (const v of vs) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
};

function parseLevers(v: unknown): XaLever[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((l) => ({
    metric: str(l.metric, l.key, l.name) ?? "",
    points: num(l.points ?? l.gain ?? l.pointsGained ?? l.delta),
    text: str(l.direction, l.text, l.label, l.description, l.advice),
  }));
}

function parseMix(v: unknown): Record<string, number> | null {
  if (isObj(v)) {
    const out: Record<string, number> = {};
    for (const [k, w] of Object.entries(v)) if (num(w) != null) out[k] = num(w)!;
    return Object.keys(out).length ? out : null;
  }
  if (Array.isArray(v)) {
    const out: Record<string, number> = {};
    for (const e of v.filter(isObj)) {
      const k = str(e.subtype, e.name, e.key);
      const w = num(e.weight ?? e.share ?? e.pct);
      if (k && w != null) out[k] = w;
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}

function moveFrom(kind: string, m: unknown): ArsenalMove | null {
  if (typeof m === "string") return { kind, title: m, detail: null };
  if (!isObj(m)) return null;
  const k = str(m.type, m.kind, m.action)?.toLowerCase() ?? kind;
  const title = str(m.title, m.label, m.pitch, m.subtype, m.name, m.code, m.key) ?? k;
  const target = isObj(m.target) ? m.target : m;
  const shape = [num(target.velocity ?? target.velo), num(target.ivb), num(target.hb)];
  const shapeText = shape.some((x) => x != null)
    ? `target ${shape[0] != null ? `${shape[0].toFixed(1)} mph` : ""}${shape[1] != null ? ` · ${shape[1].toFixed(1)}" IVB` : ""}${shape[2] != null ? ` · ${shape[2].toFixed(1)}" HB` : ""}`.trim()
    : null;
  const gain = num(m.arsenalGain ?? m.gain ?? m.delta);
  const detail = [str(m.reason, m.detail, m.description, m.summary, m.why), shapeText, gain != null ? `arsenal ${gain > 0 ? "+" : ""}${gain.toFixed(1)}` : null]
    .filter(Boolean).join(" · ");
  return { kind: k, title, detail: detail || null };
}

function parseMoves(v: unknown): ArsenalMove[] {
  if (Array.isArray(v)) return v.map((m) => moveFrom("move", m)).filter((m): m is ArsenalMove => !!m);
  if (isObj(v)) {
    return (["add", "drop", "rework"] as const).flatMap((k) => {
      const list = v[k];
      return (Array.isArray(list) ? list : list ? [list] : []).map((m) => moveFrom(k, m)).filter((m): m is ArsenalMove => !!m);
    });
  }
  return [];
}

export function parseResult(r: unknown, level: XaLevel): XaGraded {
  const res = isObj(r) ? r : {};
  const pitches = new Map<string, PitchGrade>();
  for (const p of Array.isArray(res.pitches) ? res.pitches.filter(isObj) : []) {
    const score = num(p.score);
    const key = str(p.key, p.code);
    if (score == null || !key) continue;
    pitches.set(key, {
      score: Math.round(score),
      label: str(p.gradeLabel, p.label) ?? "",
      subtype: str(p.subtype, p.displayType) ?? "",
      subtypeMix: parseMix(p.subtypeMix),
      stuffPlus: num(p.stuffPlus),
      stuffPlusType: num(p.stuffPlusType),
      levers: parseLevers(p.levers),
    });
  }
  const arsenalScore = num(res.arsenalScore);
  const slot = isObj(res.slot)
    ? { angle: num(res.slot.armAngle ?? res.slot.angle ?? res.slot.degrees), source: str(res.slot.source), label: str(res.slot.label, res.slot.slotLabel) }
    : null;
  return {
    pitches,
    arsenal: arsenalScore == null || !pitches.size ? null : {
      score: Math.round(arsenalScore),
      label: str(res.arsenalLabel) ?? "",
      stuffPlus: num(res.arsenalStuffPlus),
      fit: num(res.arsenalFit),
      compLevel: level,
      slot,
      moves: parseMoves(res.moves),
    },
  };
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

// Raw Worker results per identical request (hand + level + pitches), 6 h.
const CACHE_TTL_MS = 6 * 3_600_000;
const CACHE_MAX = 2_000;
const cache = new Map<string, { at: number; raw: unknown }>();

function cached(key: string): unknown | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.raw;
}

function remember(key: string, raw: unknown) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), raw });
}

async function post(items: XaItemIn[]): Promise<unknown[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${xarsenalUrl()}/?action=scoreArsenal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
      cache: "no-store",
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`xArsenal service returned HTTP ${res.status}`);
    }
    if (!res.ok || (isObj(json) && json.error)) {
      throw new Error(`xArsenal service: ${isObj(json) && json.error ? String(json.error) : `HTTP ${res.status}`}`);
    }
    const results = isObj(json) && Array.isArray(json.results) ? json.results : null;
    if (!results) throw new Error("xArsenal service returned no results");
    return results;
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw new Error("xArsenal service timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Grades several arsenals in one Worker call (cached ones aren't re-sent), keyed by item id.
 * Throws when the Worker can't be reached; callers show grades as unavailable.
 */
export async function gradeArsenals(items: XaItemIn[]): Promise<Map<string, XaGraded>> {
  const out = new Map<string, XaGraded>();
  const todo = items.filter((it) => it.pitches.length);
  const keyOf = (it: XaItemIn) => JSON.stringify([it.hand, it.level, it.pitches]);
  const missing = todo.filter((it) => cached(keyOf(it)) === undefined);
  if (missing.length) {
    const results = await post(missing.map((it, i) => ({ ...it, id: String(i) })));
    const byId = new Map(results.filter(isObj).map((r) => [String(r.id), r]));
    missing.forEach((it, i) => {
      const raw = byId.get(String(i));
      if (raw !== undefined) remember(keyOf(it), raw);
    });
  }
  for (const it of todo) {
    const raw = cached(keyOf(it));
    if (raw !== undefined) out.set(it.id, parseResult(raw, it.level));
  }
  return out;
}
