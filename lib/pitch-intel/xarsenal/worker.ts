/**
 * xArsenal + 8-Stuff+: graded by Ryan's 8ctane API Worker, the single source every 8ctane app
 * calls so all apps show identical grades. The benchmarks and the 8-Stuff+ model are private to
 * the Worker, so grades can't be computed here.
 *
 *   POST {PITCH_INTEL_XARSENAL_URL}/?action=scoreArsenal
 *   body: { items: [{ id, hand, level, veloWeighted, pitches: [...] }] }  →  { results: [{ id, ...grades }] }
 *
 * Contract: Ryan's handoff "8ctane Pitch Intelligence — Backend Handoff" (Nov 4 2026, commit 0a683d0),
 * 05-XARSENAL-SPEC. Only pitch averages go out (no names: ids are opaque keys). Raw results are
 * cached in memory for 6 h per identical request.
 *
 * The Worker's own labels / description / metric status use a pre-rescale cut, so parseResult
 * replaces them with Ryan's frontend rules (./normalize.ts), like his app does.
 */

import { XA_IMPORTANCE_RANK, XA_METRIC_LABEL, XA_METRIC_ORDER, xaDescribe, xaGrade, xaLabel, xaWhy } from "./normalize";

export const DEFAULT_XARSENAL_URL = "https://8ctane-api.ryan-77b.workers.dev";
const TIMEOUT_MS = 20_000;

export function xarsenalUrl(): string {
  return (process.env.PITCH_INTEL_XARSENAL_URL || DEFAULT_XARSENAL_URL).replace(/\/+$/, "");
}

/**
 * 8ctane grades at four levels only: MLB, College, High School, Youth. MiLB, Indy / Atlantic
 * League, summer ball, blank and anything else go out as "MLB" (Joey, Nov 5 2026). The Worker
 * itself would grade MiLB and Indy at their own levels; we don't use those on purpose.
 */
export type XaLevel = "MLB" | "College" | "High School" | "Youth";
export function xaLevel(level: string | null | undefined): XaLevel {
  const s = (level ?? "").trim();
  if (/college|ncaa|naia|juco|\bd[123]\b/i.test(s)) return "College";
  if (/high school|\bhs\b/i.test(s)) return "High School";
  if (/youth|\b1[0-4]u\b/i.test(s)) return "Youth";
  return "MLB";
}

/** Level label before (or without) a response, in the Worker's names. */
export function xaCompLevel(level: string | null | undefined): string {
  const l = xaLevel(level);
  return l === "Youth" ? "Youth (14U)" : l;
}

/**
 * One pitch type's averages, as the Worker takes them.
 * - hb: right-handed convention = Statcast −pfx_x × 12 (+ = toward 3B / the pitcher's right), lefties
 *   NOT pre-flipped; the Worker mirrors them. Verified Nov 5 2026 on Cleavinger (LHP) and Weiss (RHP):
 *   flipping it collapses both arsenals (sinkers / sweepers grade 20).
 * - releaseSide: the Worker ignores the sign (identical grades with it negated, with and without arm
 *   angle), so each source's raw value goes out.
 */
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
  /** Only when measured (TrackMan / Rapsodo / Hawk-Eye): an estimate must not be graded. */
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

/** One metric row of a pitch grade: a 20-80 sub-score, its importance tier and the direction that helps. */
export interface XaMetric {
  key: string;
  label: string;
  score: number;
  importance: "primary" | "secondary" | "minor" | string;
  direction: string | null;
  /** Gap / pairing metrics only: the measured separation the Worker graded. */
  value: number | null;
}

export interface PitchGrade {
  /** xArsenal score (20-80 scale, 50 = MLB average for that shape). Can fall outside 20-80. */
  score: number;
  /** Score rounded to the nearest 5, clamped 20-80. */
  grade: number;
  /** From the grade (Ryan's cut), never the Worker's own label. */
  label: string;
  category: string | null;
  subtype: string;
  displayType: string | null;
  /** Shapes the grade blends, e.g. { "Sweeper": 48, "Lift Sweeper": 25 } (percent). */
  subtypeMix: Record<string, number> | null;
  /** 8-Stuff+ (100 = average MLB pitch) and vs. its own type. */
  stuffPlus: number | null;
  stuffPlusType: number | null;
  levers: XaLever[];
  /** Metric rows with an importance and a score, primary → secondary → minor. */
  metrics: XaMetric[];
  /** "Carried by … Held back by …" (Ryan's xaWhy). */
  why: string;
  /** Fastball the gap metrics are measured against, e.g. "FF/SI". */
  vsFastball: string | null;
  /** True when the Worker estimated VAA (none was sent); vaaEst is the estimate it used. Show "est.". */
  vaaEstimated: boolean;
  vaaEst: number | null;
  /** Slot-adjusted IVB the Worker graded on (fastballs). */
  ivbSlotAdj: number | null;
  spinEfficiency: number | null;
  spinEffEstimated: boolean;
}

export interface ArsenalMove {
  kind: "add" | "drop" | "rework" | string;
  /** Pitch the move is about (drop / rework: the arsenal key; add: the suggested code, when given). */
  key: string | null;
  title: string;
  reason: string | null;
  /** Add: the suggested shape ("assumes an average version"). HB arm-side positive is assumed (unverified, handoff #21). */
  target: { velo: number | null; ivb: number | null; hb: number | null } | null;
  /** Arsenal points gained. */
  gain: number | null;
  /** Add: Arsenal Fit points gained. */
  fitGain: number | null;
  /** Drop / rework: the pitch's current score. */
  score: number | null;
  /** Rework: lever directions to focus on. */
  focus: string[];
  /** One-line summary (kept for compact displays). */
  detail: string | null;
}

export interface ArsenalFit {
  score: number;
  parts: { coverage: number | null; platoon: number | null; speed: number | null; redundancy: number | null };
  /** Movement directions covered at full credit (credit ≥ 0.5). */
  strongDirections: string[];
  bestArmSide: number | null;
  bestGloveSide: number | null;
  speedSpread: number | null;
  speedEvenness: number | null;
  duplicates: string[];
}

export interface ArsenalGrade {
  score: number;
  grade: number;
  label: string;
  /** Ryan's sentence: best / worst pitch and the arsenal grade. */
  description: string;
  /** The pitch-grade component of the arsenal score (not a plain mean). */
  pitchScore: number | null;
  stuffPlus: number | null;
  /** Arsenal Fit score (kept as a number for compact displays). */
  fit: number | null;
  fitDetail: ArsenalFit | null;
  /** Level the Worker graded at: MLB, College, High School or Youth (14U). */
  compLevel: string;
  slot: { angle: number | null; source: string | null; label: string | null } | null;
  moves: ArsenalMove[];
  /** 8-Stuff+ model version, e.g. "8-Stuff+ v1". */
  stuffVersion: string | null;
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
const bool = (v: unknown) => v === true || v === "true";

function parseLevers(v: unknown): XaLever[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((l) => ({
    metric: str(l.metric, l.key, l.name) ?? "",
    points: num(l.points ?? l.gain ?? l.pointsGained ?? l.delta),
    text: str(l.direction, l.text, l.label, l.description, l.advice),
  }));
}

function parseMix(v: unknown): Record<string, number> | null {
  const out: Record<string, number> = {};
  if (isObj(v)) {
    for (const [k, w] of Object.entries(v)) if (num(w) != null) out[k] = num(w)!;
  } else if (Array.isArray(v)) {
    for (const e of v) {
      if (Array.isArray(e) && typeof e[0] === "string" && num(e[1]) != null) out[e[0]] = num(e[1])!;
      else if (isObj(e)) {
        const k = str(e.subtype, e.name, e.key);
        const w = num(e.share ?? e.weight ?? e.pct);
        if (k && w != null) out[k] = w;
      }
    }
  }
  if (!Object.keys(out).length) return null;
  // Shares as percent (some responses use 0-1 weights).
  if (Object.values(out).every((w) => w <= 1)) for (const k of Object.keys(out)) out[k] = Math.round(out[k]! * 100);
  return out;
}

function parseMetrics(v: unknown): XaMetric[] {
  if (!isObj(v)) return [];
  const out: XaMetric[] = [];
  for (const [key, m] of Object.entries(v)) {
    if (!isObj(m)) continue;
    const score = num(m.score);
    const importance = str(m.importance);
    if (score == null || !importance) continue; // Ryan shows only metrics with an importance and a score
    out.push({ key, label: XA_METRIC_LABEL[key] ?? key, score: Math.round(score), importance, direction: str(m.direction), value: num(m.value) });
  }
  const ord = (k: string) => (XA_METRIC_ORDER.indexOf(k) + 1 || 99);
  return out.sort((a, b) => (XA_IMPORTANCE_RANK[a.importance] ?? 3) - (XA_IMPORTANCE_RANK[b.importance] ?? 3) || ord(a.key) - ord(b.key));
}

function moveFrom(kind: string, m: unknown): ArsenalMove | null {
  if (typeof m === "string") return { kind, key: null, title: m, reason: null, target: null, gain: null, fitGain: null, score: null, focus: [], detail: null };
  if (!isObj(m)) return null;
  const k = str(m.type, m.kind, m.action)?.toLowerCase() ?? kind;
  const key = str(m.key, m.code);
  const title = str(m.label, m.title, m.pitch, m.subtype, m.name) ?? key ?? k;
  const t = isObj(m.target) ? m.target : null;
  const target = t ? { velo: num(t.velo ?? t.velocity), ivb: num(t.ivb), hb: num(t.hb) } : null;
  const gain = num(m.gain ?? m.arsenalGain ?? m.delta);
  const fitGain = num(m.fitGain);
  const score = num(m.score);
  const focus = Array.isArray(m.levers) ? m.levers.map((l) => (isObj(l) ? str(l.direction, l.text) : str(l))).filter((x): x is string => !!x) : [];
  const reason = str(m.reason, m.detail, m.description, m.summary, m.why);
  const shape = target && (target.velo != null || target.ivb != null || target.hb != null)
    ? `target ~${[
      target.velo != null ? `${Math.round(target.velo)} mph` : null,
      target.ivb != null ? `${Math.round(target.ivb)}" IVB` : null,
      target.hb != null ? `${Math.abs(Math.round(target.hb))}" ${target.hb >= 0 ? "arm-side" : "glove-side"}` : null,
    ].filter(Boolean).join(" · ")}`
    : null;
  const detail = [
    reason,
    shape,
    focus.length ? `focus: ${focus.join(", ")}` : null,
    fitGain != null ? `Fit ${fitGain > 0 ? "+" : ""}${Math.round(fitGain)}` : null,
    gain != null ? `arsenal ${gain > 0 ? "+" : ""}${Math.round(gain)}` : null,
  ].filter(Boolean).join(" · ");
  return { kind: k, key, title, reason, target, gain, fitGain, score, focus, detail: detail || null };
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

function parseFit(v: unknown): ArsenalFit | null {
  const score = num(v);
  if (score == null) return null;
  const o = isObj(v) ? v : {};
  const parts = isObj(o.parts) ? o.parts : {};
  const d = isObj(o.detail) ? o.detail : {};
  const dirs = Array.isArray(d.directions)
    ? d.directions.filter(isObj).filter((x) => (num(x.credit) ?? 0) >= 0.5).map((x) => str(x.name)).filter((x): x is string => !!x)
    : Array.isArray(d.strongDirections) ? d.strongDirections.map((x) => str(x)).filter((x): x is string => !!x) : [];
  const dups = Array.isArray(d.duplicates)
    ? d.duplicates.map((x) => (Array.isArray(x) ? x.join(" / ") : isObj(x) ? str(x.label, x.name, x.pair) ?? JSON.stringify(x) : str(x))).filter((x): x is string => !!x)
    : [];
  return {
    score: Math.round(score),
    parts: { coverage: num(parts.coverage), platoon: num(parts.platoon), speed: num(parts.speed), redundancy: num(parts.redundancy) },
    strongDirections: dirs,
    bestArmSide: num(d.bestArmSide),
    bestGloveSide: num(d.bestGloveSide),
    speedSpread: num(d.speedSpread),
    speedEvenness: num(d.speedEvenness),
    duplicates: dups,
  };
}

export function parseResult(r: unknown, level: string | null | undefined): XaGraded {
  const res = isObj(r) ? r : {};
  const pitches = new Map<string, PitchGrade>();
  for (const p of Array.isArray(res.pitches) ? res.pitches.filter(isObj) : []) {
    const raw = num(p.score);
    const key = str(p.key, p.code);
    if (raw == null || !key) continue;
    const score = Math.round(raw);
    const metrics = parseMetrics(p.metrics);
    pitches.set(key, {
      score,
      grade: xaGrade(score)!,
      label: xaLabel(score),
      category: str(p.category),
      subtype: str(p.subtype, p.displayType) ?? "",
      displayType: str(p.displayType),
      subtypeMix: parseMix(p.subtypeMix),
      stuffPlus: num(p.stuffPlus),
      stuffPlusType: num(p.stuffPlusType),
      levers: parseLevers(p.levers),
      metrics,
      why: metrics.length ? xaWhy(metrics) : "",
      vsFastball: str(p.vsFastball),
      vaaEstimated: bool(p.vaaEstimated),
      vaaEst: num(p.vaaEst),
      ivbSlotAdj: num(p.ivbSlotAdj),
      spinEfficiency: num(p.spinEfficiency),
      spinEffEstimated: bool(p.spinEffEstimated),
    });
  }
  const raw = num(res.arsenalScore);
  const slot = isObj(res.slot)
    ? { angle: num(res.slot.armAngle ?? res.slot.angle ?? res.slot.degrees), source: str(res.slot.source), label: str(res.slot.label, res.slot.slotLabel) }
    : null;
  const fitDetail = parseFit(res.arsenalFit);
  if (raw == null || !pitches.size) return { pitches, arsenal: null };
  const score = Math.round(raw);
  return {
    pitches,
    arsenal: {
      score,
      grade: xaGrade(score)!,
      label: xaLabel(score),
      description: xaDescribe([...pitches.entries()].map(([key, g]) => ({ key, score: g.score })), score),
      pitchScore: num(res.arsenalPitchScore),
      stuffPlus: num(res.arsenalStuffPlus),
      fit: fitDetail?.score ?? null,
      fitDetail,
      compLevel: str(res.compLevel) ?? xaCompLevel(level),
      slot,
      moves: parseMoves(res.moves),
      stuffVersion: str(res.stuffPlusVersion),
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

/** Raw POST of a batch; every item gets veloWeighted: true (what Ryan's app always sends). */
export async function postScoreArsenal(items: XaItemIn[]): Promise<unknown[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${xarsenalUrl()}/?action=scoreArsenal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: items.map((it) => ({ ...it, veloWeighted: true })) }),
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
    const results = await postScoreArsenal(missing.map((it, i) => ({ ...it, id: String(i) })));
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
