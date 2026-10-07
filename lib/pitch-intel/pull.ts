/**
 * Pull orchestration: fetch -> check -> upsert -> log. Used by the CLI, the
 * dashboard buttons and the nightly route, so behavior is identical everywhere.
 */

import {
  DEFAULT_BACKFILL_SEASONS,
  EARLIEST_SAVANT_SEASON,
  NIGHTLY_LOCK_MINUTES,
  NIGHTLY_LOOKBACK_DAYS,
  REQUEST_PAUSE_MS,
  SAVANT_ROW_CAP,
} from "./config";
import { parseCsv, type CsvRow } from "./csv";
import { addDays, maxDate, minDate, splitRange, todayET } from "./dates";
import { runChecks, type CheckFlag, type CheckResult } from "./checks";
import { fetchSavantCsv, SavantError, type SavantLevel } from "./savant/client";
import { dedupeByKey, toPitchRow, type PitchRow } from "./savant/rows";
import {
  fillThrowsIfMissing,
  finishRun,
  getEnabledLinks,
  nightlyInFlight,
  startRun,
  touchLink,
  upsertPitches,
  type Link,
  type RunStatus,
  type RunTrigger,
} from "./db";

export interface PullResult {
  linkId: number;
  athleteName: string;
  runId: number | null;
  from: string | null;
  to: string | null;
  status: Exclude<RunStatus, "running">;
  fetched: number;
  inserted: number;
  updated: number;
  flags: CheckFlag[];
  fatal: string[];
  error: string | null;
  lastGameDate: string | null;
  /** Per-level row counts and pitch-type summary, for CLI output and the run log. */
  summary: CheckResult["stats"] | null;
}

export interface PullOptions {
  /** Fetch and check only; write nothing (no pitches, no run log). */
  dryRun?: boolean;
  levels?: SavantLevel[];
  log?: (line: string) => void;
}

export const NO_PITCHES_MESSAGE =
  "Savant returned no pitches for this range. Savant only tracks MLB, Triple-A (2023+) and the Florida State League (2021+); games at other levels aren't available.";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function errorMessage(err: unknown): string {
  if (err instanceof SavantError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

interface LevelBatch {
  level: SavantLevel | "csv";
  headers: string[];
  rows: CsvRow[];
}

/** Fetches one level, splitting the date range if it hits Savant's row cap. */
async function fetchLevel(
  level: SavantLevel,
  mlbamId: string,
  from: string,
  to: string,
  log: (line: string) => void,
): Promise<LevelBatch> {
  const { text } = await fetchSavantCsv(level, mlbamId, from, to);
  const parsed = parseCsv(text);
  if (parsed.rows.length >= SAVANT_ROW_CAP) {
    const halves = splitRange(from, to);
    if (halves) {
      log(`  ${level}: ${parsed.rows.length} rows hit the cap; splitting ${from}..${to}`);
      const a = await fetchLevel(level, mlbamId, halves[0][0], halves[0][1], log);
      await sleep(REQUEST_PAUSE_MS);
      const b = await fetchLevel(level, mlbamId, halves[1][0], halves[1][1], log);
      return { level, headers: a.headers.length ? a.headers : b.headers, rows: [...a.rows, ...b.rows] };
    }
  }
  return { level, headers: parsed.headers, rows: parsed.rows };
}

type Stats = CheckResult["stats"];

function mergeStats(a: Stats | null, b: Stats): Stats {
  if (!a) return b;
  return {
    rows: a.rows + b.rows,
    games: a.games + b.games,
    takesPct: a.takesPct ?? b.takesPct,
    dateMin: a.dateMin && b.dateMin ? minDate(a.dateMin, b.dateMin) : a.dateMin ?? b.dateMin,
    dateMax: maxDate(a.dateMax, b.dateMax),
    pitchTypes: [...a.pitchTypes, ...b.pitchTypes],
  };
}

/** Runs checks, then (unless dry-run or fatal) saves the batches and logs the run. */
async function processBatches(
  link: Link,
  batches: LevelBatch[],
  extraFlags: CheckFlag[],
  ctx: { runId: number | null; from: string | null; to: string | null; dryRun: boolean },
): Promise<PullResult> {
  const fatal: string[] = [];
  const flags: CheckFlag[] = [...extraFlags];
  let summary: CheckResult["stats"] | null = null;
  const pitchRows: Array<PitchRow & { __level: LevelBatch["level"] }> = [];

  for (const batch of batches) {
    const result = runChecks(batch.headers, batch.rows, link.source_player_id, { checkRowCap: batch.level === "csv" });
    fatal.push(...result.fatal.map((m) => `${batch.level}: ${m}`));
    flags.push(...result.flags.map((f) => ({ ...f, message: batches.length > 1 ? `${batch.level}: ${f.message}` : f.message })));
    if (batch.rows.length) summary = mergeStats(summary, result.stats);
    for (const r of batch.rows) pitchRows.push({ ...toPitchRow(r), __level: batch.level });
  }

  const fetched = pitchRows.length;
  const deduped = dedupeByKey(pitchRows);
  if (deduped.missingKey) flags.push({ code: "missing_key", message: `${deduped.missingKey} rows lacked game/at-bat/pitch number and were skipped` });

  const lastGameDate = deduped.rows.reduce<string | null>((m, r) => maxDate(m, (r.game_date as string | null) ?? null), null);
  const base = {
    linkId: link.id,
    athleteName: link.athlete_name,
    runId: ctx.runId,
    from: ctx.from,
    to: ctx.to,
    fetched,
    flags,
    fatal,
    lastGameDate,
    summary,
  };

  if (fatal.length) {
    const error = fatal.join("; ");
    if (ctx.runId != null) {
      await finishRun(ctx.runId, { status: "failed", fetched, inserted: 0, updated: 0, checks: { fatal, flags, summary }, error });
    }
    return { ...base, status: "failed", inserted: 0, updated: 0, error };
  }

  let inserted = 0;
  let updated = 0;
  if (!ctx.dryRun && deduped.rows.length) {
    ({ inserted, updated } = await upsertPitches(deduped.rows, {
      athleteUuid: link.athlete_uuid,
      linkId: link.id,
      pullRunId: ctx.runId,
      defaultLevel: "csv",
    }));
  }

  const status: PullResult["status"] = flags.length ? "flagged" : "ok";
  if (!ctx.dryRun) {
    await touchLink(link.id, lastGameDate);
    const throws = deduped.rows.find((r) => r.p_throws === "L" || r.p_throws === "R")?.p_throws;
    if (!link.throws && (throws === "L" || throws === "R")) await fillThrowsIfMissing(link.id, throws);
    if (ctx.runId != null) {
      await finishRun(ctx.runId, { status, fetched, inserted, updated, checks: { flags, summary }, error: null });
    }
  }
  return { ...base, status, inserted, updated, error: null };
}

/** Pulls one linked athlete's pitches for a date range (inclusive) from MLB and minor-league Savant. */
export async function pullRange(
  link: Link,
  from: string,
  to: string,
  trigger: RunTrigger,
  opts: PullOptions = {},
): Promise<PullResult> {
  const log = opts.log ?? (() => {});
  const levels = opts.levels ?? ["mlb", "minors"];
  const dryRun = !!opts.dryRun;
  const runId = dryRun ? null : await startRun({ linkId: link.id, athleteUuid: link.athlete_uuid, trigger, from, to });

  try {
    const batches: LevelBatch[] = [];
    const flags: CheckFlag[] = [];
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      if (i > 0) await sleep(REQUEST_PAUSE_MS);
      try {
        const batch = await fetchLevel(level, link.source_player_id, from, to, log);
        log(`  ${level}: ${batch.rows.length} pitches`);
        batches.push(batch);
      } catch (err) {
        // The minor-league download is a bonus source: if it fails, keep the MLB data and flag it.
        if (level === "minors" && levels.includes("mlb")) {
          flags.push({ code: "minors_unavailable", message: `Minor-league download failed: ${errorMessage(err)}` });
          log(`  minors: failed (${errorMessage(err)})`);
        } else {
          throw err;
        }
      }
    }
    // An empty manual or backfill pull usually means the player only pitched at levels Savant doesn't track.
    // Nightly runs skip this flag: off-season and off-day nights are empty for everyone.
    const totalRows = batches.reduce((n, b) => n + b.rows.length, 0);
    if (totalRows === 0 && trigger !== "nightly") {
      flags.push({ code: "no_pitches", message: NO_PITCHES_MESSAGE });
    }
    return await processBatches(link, batches, flags, { runId, from, to, dryRun });
  } catch (err) {
    const error = errorMessage(err);
    if (runId != null) {
      await finishRun(runId, { status: "failed", fetched: 0, inserted: 0, updated: 0, checks: {}, error });
    }
    return {
      linkId: link.id,
      athleteName: link.athlete_name,
      runId,
      from,
      to,
      status: "failed",
      fetched: 0,
      inserted: 0,
      updated: 0,
      flags: [],
      fatal: [],
      error,
      lastGameDate: null,
      summary: null,
    };
  }
}

/** Pulls whole seasons, one request per level per season. */
export async function backfill(
  link: Link,
  fromSeason: number,
  trigger: RunTrigger = "backfill",
  opts: PullOptions = {},
): Promise<PullResult[]> {
  const log = opts.log ?? (() => {});
  const today = todayET();
  const thisYear = Number(today.slice(0, 4));
  const start = Math.max(EARLIEST_SAVANT_SEASON, Math.min(fromSeason, thisYear));
  const results: PullResult[] = [];
  for (let year = start; year <= thisYear; year++) {
    if (year > start) await sleep(REQUEST_PAUSE_MS);
    log(`${link.athlete_name}: season ${year}`);
    results.push(await pullRange(link, `${year}-01-01`, minDate(`${year}-12-31`, today), trigger, opts));
  }
  return results;
}

export function defaultBackfillFrom(today: string = todayET()): number {
  return Number(today.slice(0, 4)) - (DEFAULT_BACKFILL_SEASONS - 1);
}

/** Saves a Savant CSV that was downloaded by hand (same checks as a pull). */
export async function importCsv(link: Link, csvText: string, opts: PullOptions = {}): Promise<PullResult> {
  return importRows(link, parseCsv(csvText), opts);
}

/** Same as importCsv, for rows already read from a CSV or XLSX upload. */
export async function importRows(link: Link, parsed: { headers: string[]; rows: CsvRow[] }, opts: PullOptions = {}): Promise<PullResult> {
  const dates = parsed.rows.map((r) => (r.game_date ?? "").slice(0, 10)).filter(Boolean).sort();
  const from = dates[0] ?? null;
  const to = dates[dates.length - 1] ?? null;
  const dryRun = !!opts.dryRun;
  const runId = dryRun ? null : await startRun({ linkId: link.id, athleteUuid: link.athlete_uuid, trigger: "csv", from, to });
  try {
    return await processBatches(link, [{ level: "csv", headers: parsed.headers, rows: parsed.rows }], [], { runId, from, to, dryRun });
  } catch (err) {
    const error = errorMessage(err);
    if (runId != null) await finishRun(runId, { status: "failed", fetched: 0, inserted: 0, updated: 0, checks: {}, error });
    throw err;
  }
}

export interface NightlySummary {
  skipped: boolean;
  reason?: string;
  date: string;
  results: PullResult[];
  ok: number;
  flagged: number;
  failed: number;
}

/** Re-pulls every enabled Savant link from (last game - lookback) through today. */
export async function runNightly(opts: PullOptions = {}): Promise<NightlySummary> {
  const log = opts.log ?? (() => {});
  const today = todayET();
  if (!opts.dryRun && (await nightlyInFlight(NIGHTLY_LOCK_MINUTES))) {
    return { skipped: true, reason: "Another nightly run is still in progress", date: today, results: [], ok: 0, flagged: 0, failed: 0 };
  }
  const links = await getEnabledLinks("savant");
  const results: PullResult[] = [];
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    if (i > 0) await sleep(REQUEST_PAUSE_MS);
    const anchor = link.last_game_date ? minDate(link.last_game_date, today) : today;
    const from = addDays(anchor, -NIGHTLY_LOOKBACK_DAYS);
    log(`${link.athlete_name} (${link.source_player_id}): ${from}..${today}`);
    const r = await pullRange(link, from, today, "nightly", opts);
    log(`  -> ${r.status}: ${r.inserted} new, ${r.updated} updated${r.error ? ` (${r.error})` : ""}`);
    results.push(r);
  }
  return {
    skipped: false,
    date: today,
    results,
    ok: results.filter((r) => r.status === "ok").length,
    flagged: results.filter((r) => r.status === "flagged").length,
    failed: results.filter((r) => r.status === "failed").length,
  };
}
