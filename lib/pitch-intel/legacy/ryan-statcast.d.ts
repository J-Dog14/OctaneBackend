/**
 * Types for the auto-generated extract of Ryan's parsers (ryan-statcast.js).
 * Rows are CSV-style: every value a string, blanks as "".
 */

export type StatcastCsvRow = Record<string, string>;

/** One outing as parseStatcastBulk builds it (the shape his Bulk Import sends to addOuting). */
export interface RyanParsedOuting {
  date: string;
  opponent: string;
  total_pitches: number;
  whiffs: number;
  calledStrikes: number;
  walks: number;
  ks: number;
  hrs: number;
  hits: number;
  ip: number;
  hbp: number;
  avgEV: number | null;
  hardHitPct: number | null;
  zonePct: number | null;
  oSwingPct: number | null;
  zSwingPct: number | null;
  zContactPct: number | null;
  swingPct: number | null;
  strikePct: number | null;
  gbPct: number | null;
  fbPct: number | null;
  ldPct: number | null;
  fpStrikePct: number | null;
  oonStrikePct: number | null;
  race2kPct: number | null;
  putawayPct: number | null;
  sit: unknown;
  pitchMap: Record<string, { count: number; avgVelo?: number | null; whiffPct?: number | null; [k: string]: unknown }>;
}

export function parseStatcastBulk(rows: StatcastCsvRow[]): { pitcher: string; outings: RyanParsedOuting[] };
/** Trackman rows (original column names) -> one outing per Date, as his Bulk Import builds them. */
export function parseTrackmanBulk(rows: Array<Record<string, string>>): { pitcher: string; outings: RyanParsedOuting[] };
export function computeSituational(rows: StatcastCsvRow[]): unknown;
