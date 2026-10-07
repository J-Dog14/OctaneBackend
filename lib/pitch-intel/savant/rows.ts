import type { CsvRow } from "../csv";
import { SAVANT_COLUMNS, SAVANT_COLUMN_NAMES } from "./columns";

export type PitchValue = string | number | null;

/** One savant_pitches row as sent to Postgres (via jsonb_populate_recordset). */
export interface PitchRow {
  [column: string]: PitchValue | Record<string, string>;
  raw_extra: Record<string, string>;
}

const EMPTY = new Set(["", "null", "NULL", "NA", "NaN", "nan", "None"]);

function toNumber(v: string): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Converts one CSV row (all strings) into typed column values plus raw_extra for unknown columns. */
export function toPitchRow(csv: CsvRow): PitchRow {
  const row: PitchRow = { raw_extra: {} };
  for (const [name, type] of SAVANT_COLUMNS) {
    const raw = csv[name];
    if (raw == null || EMPTY.has(raw.trim())) {
      row[name] = null;
      continue;
    }
    const v = raw.trim();
    switch (type) {
      case "float":
        row[name] = toNumber(v);
        break;
      case "int":
      case "bigint": {
        const n = toNumber(v);
        row[name] = n == null ? null : Math.trunc(n);
        break;
      }
      case "date":
        row[name] = /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
        break;
      default:
        row[name] = v;
    }
  }
  for (const [key, value] of Object.entries(csv)) {
    if (!SAVANT_COLUMN_NAMES.has(key) && key !== "" && value !== "" && !EMPTY.has(value)) {
      row.raw_extra[key] = value;
    }
  }
  return row;
}

export function pitchKey(row: Record<string, unknown>): string | null {
  const { game_pk, at_bat_number, pitch_number } = row;
  if (game_pk == null || at_bat_number == null || pitch_number == null) return null;
  return `${game_pk}|${at_bat_number}|${pitch_number}`;
}

/** Drops rows missing the pitch key and collapses duplicate keys (last one wins). */
export function dedupeByKey<T extends PitchRow>(rows: T[]): { rows: T[]; missingKey: number; duplicates: number } {
  const byKey = new Map<string, T>();
  let missingKey = 0;
  for (const r of rows) {
    const key = pitchKey(r);
    if (!key || r.game_date == null || r.pitcher == null) {
      missingKey += 1;
      continue;
    }
    byKey.set(key, r);
  }
  const kept = rows.length - missingKey;
  return { rows: [...byKey.values()], missingKey, duplicates: kept - byKey.size };
}
