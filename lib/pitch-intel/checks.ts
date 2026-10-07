/**
 * Import checks from the Pitch Intelligence rules (01-DATA-INPUT.md, 04-TROUBLESHOOTING.md),
 * automated so a scheduled pull gets the same scrutiny as a hand import.
 *
 * fatal  -> nothing is saved, run marked failed
 * flags  -> data saved, run marked flagged and shown on the dashboard
 */

import type { CsvRow } from "./csv";
import { FEATURE_COLUMNS, REQUIRED_COLUMNS } from "./savant/columns";
import { MIN_PITCHES_FOR_TAKES_CHECK, SAVANT_ROW_CAP, TAKES_PCT_RANGE } from "./config";

export interface CheckFlag {
  code: string;
  message: string;
}

export interface PitchTypeSummary {
  pitchType: string;
  count: number;
  avgVelo: number | null;
  /** Inches, induced vertical break (pfx_z * 12). */
  avgIvb: number | null;
  /** Inches, catcher's view as Savant reports it (pfx_x * 12), not arm-side adjusted. */
  avgHb: number | null;
}

export interface CheckResult {
  fatal: string[];
  flags: CheckFlag[];
  stats: {
    rows: number;
    takesPct: number | null;
    dateMin: string | null;
    dateMax: string | null;
    games: number;
    pitchTypes: PitchTypeSummary[];
  };
}

/** Pitch descriptions that are swings; everything else is a take. */
const SWINGS = new Set([
  "swinging_strike",
  "swinging_strike_blocked",
  "foul",
  "foul_tip",
  "foul_bunt",
  "missed_bunt",
  "bunt_foul_tip",
  "foul_pitchout",
  "swinging_pitchout",
  "hit_into_play",
  "hit_into_play_no_out",
  "hit_into_play_score",
]);

const MIN_PITCHES_FOR_TAG_CHECK = 10;

function avg(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function round1(n: number | null): number | null {
  return n == null ? null : Math.round(n * 10) / 10;
}

function num(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Shape-vs-tag sanity rules. Deliberately loose: they only catch shapes that
 * contradict the tag outright (04-TROUBLESHOOTING: an 87 mph "changeup" with
 * ~0 IVB/HB is a gyro slider).
 */
function tagFlags(s: PitchTypeSummary): string | null {
  if (s.count < MIN_PITCHES_FOR_TAG_CHECK || s.avgIvb == null || s.avgHb == null) return null;
  const ivb = s.avgIvb;
  const hb = Math.abs(s.avgHb);
  switch (s.pitchType) {
    case "CH":
    case "FS":
      if (Math.abs(ivb) < 4 && hb < 4) return `${s.pitchType} averages ${ivb}" IVB and ${s.avgHb}" HB: looks like a gyro slider`;
      return null;
    case "FF":
      if (ivb < 8) return `FF averages only ${ivb}" IVB: check whether these are sinkers or cutters`;
      return null;
    case "SI":
      if (ivb > 18) return `SI averages ${ivb}" IVB: check whether these are four-seamers`;
      return null;
    case "CU":
    case "KC":
      if (ivb > 2) return `${s.pitchType} averages +${ivb}" IVB: check the tag`;
      return null;
    default:
      return null;
  }
}

export function runChecks(
  headers: string[],
  rows: CsvRow[],
  expectedPitcherId: string,
  options: { checkRowCap?: boolean } = {},
): CheckResult {
  const fatal: string[] = [];
  const flags: CheckFlag[] = [];
  const headerSet = new Set(headers);

  const result: CheckResult = {
    fatal,
    flags,
    stats: { rows: rows.length, takesPct: null, dateMin: null, dateMax: null, games: 0, pitchTypes: [] },
  };
  if (rows.length === 0) return result;

  const missingRequired = REQUIRED_COLUMNS.filter((c) => !headerSet.has(c));
  if (missingRequired.length) fatal.push(`Missing required columns: ${missingRequired.join(", ")}`);

  const missingFeature = FEATURE_COLUMNS.filter((c) => !headerSet.has(c));
  if (missingFeature.length) {
    flags.push({ code: "missing_columns", message: `Columns missing (those features will show "—"): ${missingFeature.join(", ")}` });
  }

  // Savant pulls split their date range before reaching the cap; a hand-downloaded CSV can't.
  if ((options.checkRowCap ?? true) && rows.length >= SAVANT_ROW_CAP) {
    fatal.push(`Hit Savant's ${SAVANT_ROW_CAP.toLocaleString()}-row cap; the export is truncated`);
  }

  if (headerSet.has("pitcher")) {
    const wrong = rows.filter((r) => (r.pitcher ?? "").trim() !== expectedPitcherId).length;
    if (wrong > 0) fatal.push(`${wrong} of ${rows.length} rows belong to a different pitcher than MLB ID ${expectedPitcherId}`);
  }

  // Dates and games
  const dates = rows.map((r) => (r.game_date ?? "").slice(0, 10)).filter(Boolean).sort();
  result.stats.dateMin = dates[0] ?? null;
  result.stats.dateMax = dates[dates.length - 1] ?? null;
  result.stats.games = new Set(rows.map((r) => r.game_pk)).size;

  // Takes share
  const withDesc = rows.filter((r) => (r.description ?? "") !== "");
  if (withDesc.length) {
    const takes = withDesc.filter((r) => !SWINGS.has(r.description)).length;
    const pct = (takes / withDesc.length) * 100;
    result.stats.takesPct = round1(pct);
    const [lo, hi] = TAKES_PCT_RANGE;
    if (withDesc.length >= MIN_PITCHES_FOR_TAKES_CHECK && (pct < lo || pct > hi)) {
      flags.push({
        code: "takes_out_of_range",
        message: `Takes are ${round1(pct)}% of pitches (expected ${lo}–${hi}%): the export may be filtered`,
      });
    }
  }

  // Pitch-type shapes
  const byType = new Map<string, { velo: number[]; ivb: number[]; hb: number[]; count: number }>();
  for (const r of rows) {
    const pt = (r.pitch_type ?? "").trim() || "UNKNOWN";
    const b = byType.get(pt) ?? { velo: [], ivb: [], hb: [], count: 0 };
    b.count += 1;
    const v = num(r.release_speed);
    const z = num(r.pfx_z);
    const x = num(r.pfx_x);
    if (v != null) b.velo.push(v);
    if (z != null) b.ivb.push(z * 12);
    if (x != null) b.hb.push(x * 12);
    byType.set(pt, b);
  }
  result.stats.pitchTypes = [...byType.entries()]
    .map(([pitchType, b]) => ({
      pitchType,
      count: b.count,
      avgVelo: round1(avg(b.velo)),
      avgIvb: round1(avg(b.ivb)),
      avgHb: round1(avg(b.hb)),
    }))
    .sort((a, b) => b.count - a.count);

  for (const s of result.stats.pitchTypes) {
    const msg = tagFlags(s);
    if (msg) flags.push({ code: "pitch_tag", message: msg });
  }
  const untagged = byType.get("UNKNOWN")?.count ?? 0;
  if (untagged > 0) flags.push({ code: "untagged_pitches", message: `${untagged} pitches have no pitch_type` });

  return result;
}
