/** Database rows -> CSV for the coach data export. */

export type Row = Record<string, unknown>;

function isDecimal(v: object): v is { toFixed(): string } {
  // Prisma returns numeric columns from raw queries as decimal.js objects.
  return typeof (v as { toFixed?: unknown }).toFixed === "function" && typeof (v as { isNaN?: unknown }).isNaN === "function";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !Buffer.isBuffer(v) && !isDecimal(v);
}

/** One value as CSV text (unescaped). DATE columns come back as UTC midnight and are written as YYYY-MM-DD. */
export function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const iso = v.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Buffer.isBuffer(v)) return v.toString("base64");
  if (typeof v === "object" && isDecimal(v)) return v.toString();
  return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
}

/** A column value made JSON-safe the same way cellText writes it (dates, bigints, decimals as text); JSON stays JSON. */
export function jsonValue(v: unknown): unknown {
  if (v instanceof Date || typeof v === "bigint" || Buffer.isBuffer(v) || (v != null && typeof v === "object" && isDecimal(v))) return cellText(v);
  return v;
}

export function escapeCsv(s: string): string {
  // Formula-looking text (=, @) is prefixed so spreadsheets don't execute it; numbers like "-2.4" are left alone.
  const safe = /^[=@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) || /^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Rows -> CSV text (UTF-8 BOM so Excel reads names correctly). `flatten`
 * columns holding a JSON object become one column per key ("raw.PitchCall").
 * Columns appear in first-seen order across all rows.
 */
export function rowsToCsv(rows: Row[], opts: { drop?: string[]; flatten?: string[] } = {}): string {
  const drop = new Set(opts.drop ?? []);
  const flatten = new Set(opts.flatten ?? []);
  const columns: string[] = [];
  const seen = new Set<string>();
  const add = (c: string) => {
    if (!seen.has(c)) {
      seen.add(c);
      columns.push(c);
    }
  };
  const records = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (drop.has(k)) continue;
      if (flatten.has(k) && isPlainObject(v)) {
        for (const [jk, jv] of Object.entries(v)) {
          out[`${k}.${jk}`] = jv;
          add(`${k}.${jk}`);
        }
        continue;
      }
      out[k] = v;
      add(k);
    }
    return out;
  });
  const lines = [columns.map(escapeCsv).join(",")];
  for (const r of records) lines.push(columns.map((c) => escapeCsv(cellText(r[c]))).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
