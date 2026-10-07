/**
 * Pitch Intelligence settings. Change behavior here, not in the pull code.
 */

/** Seasons pulled when an athlete is first linked: current season plus the two before it. */
export const DEFAULT_BACKFILL_SEASONS = 3;

/** Earliest season Savant's pitch-by-pitch search covers. */
export const EARLIEST_SAVANT_SEASON = 2008;

/** The nightly run re-pulls this many days before each athlete's last game, to pick up Statcast corrections. */
export const NIGHTLY_LOOKBACK_DAYS = 7;

/** Pause between Savant requests, to stay polite. */
export const REQUEST_PAUSE_MS = 3000;

/** Savant silently truncates exports at 25,000 rows; at or above this we split the date range. */
export const SAVANT_ROW_CAP = 25000;

/** Savant request timeout. */
export const REQUEST_TIMEOUT_MS = 90_000;

/** Rows per upsert statement. */
export const UPSERT_CHUNK_SIZE = 500;

/** Takes outside this share of pitches (at MIN_PITCHES_FOR_TAKES_CHECK or more) flag the run: likely a filtered export. */
export const TAKES_PCT_RANGE: readonly [number, number] = [40, 60];
export const MIN_PITCHES_FOR_TAKES_CHECK = 100;

/** A nightly run younger than this that never finished blocks a second one from starting. */
export const NIGHTLY_LOCK_MINUTES = 120;

/** Dates are Eastern, matching how Savant labels game dates. */
export const TIME_ZONE = "America/New_York";
