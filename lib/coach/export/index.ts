/**
 * Coach data export: what an athlete has (per category and date) and a ZIP of
 * CSVs for whatever the coach picks. One athlete per export.
 */

import { prisma } from "@/lib/db/prisma";
import { getDb } from "@/lib/pitch-intel/db";
import { jsonValue, rowsToCsv, type Row } from "./csv";
import { buildZip, type ZipEntry } from "./zip";
import { EXPORT_CATEGORIES, isCategoryId, type ExportCategory, type ExportCategoryId, type ExportPart } from "./registry";

export { EXPORT_CATEGORIES, isCategoryId, type ExportCategoryId } from "./registry";

/** Rows without a date (some summary reports) are listed under this key. */
export const UNDATED = "undated";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ExportSessionItem {
  date: string; // YYYY-MM-DD or "undated"
  detail: string; // "game · 18 pitches", "CMJ, DJ, PPU", "Pitching 3D · 12 trials, Arm action"
  raw: boolean; // raw 3D time series exist for this date
}

export interface ExportListing {
  athlete: { athleteUuid: string; name: string };
  categories: Array<{ id: ExportCategoryId; label: string; sessions: ExportSessionItem[] }>;
}

export interface ExportSelection {
  /** Everything the athlete has. */
  all?: boolean;
  /** Category -> dates, or "all" for every date in that category. */
  categories?: Partial<Record<ExportCategoryId, string[] | "all">>;
  /** Include per-trial raw 3D time series (large). */
  raw?: boolean;
}

const SINGULAR = { pitches: "pitch", trials: "trial", tests: "test" } as const;

const dateKey = (p: ExportPart) => `COALESCE((${p.dateExpr})::text, '${UNDATED}')`;
const athleteExpr = (p: ExportPart) => p.athleteExpr ?? "athlete_uuid";

async function existingTables(tables: string[]): Promise<Set<string>> {
  const rows = await (await getDb()).query<{ t: string; ok: boolean }>(
    `SELECT t, to_regclass(t) IS NOT NULL AS ok FROM unnest($1::text[]) AS t`,
    [...new Set(tables)],
  );
  return new Set(rows.filter((r) => r.ok).map((r) => r.t));
}

const allParts = () => EXPORT_CATEGORIES.flatMap((c) => c.parts);

export async function getExportListing(athleteUuid: string): Promise<ExportListing | null> {
  const athlete = await prisma.d_athletes.findUnique({ where: { athlete_uuid: athleteUuid }, select: { athlete_uuid: true, name: true } });
  if (!athlete) return null;
  const conn = await getDb();
  const exists = await existingTables(allParts().map((p) => p.table));

  type Hit = { date: string; n: number; extra: string | null };
  const hits = new Map<ExportPart, Hit[]>();
  await Promise.all(
    allParts()
      .filter((p) => exists.has(p.table))
      .map(async (p) => {
        const rows = await conn.query<Hit>(
          `SELECT ${dateKey(p)} AS date, count(*)::int AS n${p.listExtra ? `, ${p.listExtra} AS extra` : ", NULL::text AS extra"}
             FROM ${p.from ?? p.table}
            WHERE ${athleteExpr(p)} = $1
            GROUP BY 1`,
          athleteUuid,
        );
        hits.set(p, rows.map((r) => ({ date: r.date, n: Number(r.n), extra: r.extra })));
      }),
  );

  const categories: ExportListing["categories"] = [];
  for (const c of EXPORT_CATEGORIES) {
    const byDate = new Map<string, { groups: Map<string, string[]>; raw: boolean }>();
    for (const p of c.parts) {
      for (const h of hits.get(p) ?? []) {
        if (!byDate.has(h.date)) byDate.set(h.date, { groups: new Map(), raw: false });
        const d = byDate.get(h.date)!;
        if (p.raw) {
          d.raw = true;
          continue;
        }
        const key = p.group ?? "";
        if (!d.groups.has(key)) d.groups.set(key, []);
        const bits = d.groups.get(key)!;
        if (p.listExtra && h.extra) bits.push(h.extra);
        if (p.unit) bits.push(`${h.n} ${h.n === 1 ? SINGULAR[p.unit] : p.unit}`);
      }
    }
    const sessions = [...byDate.entries()]
      // A date with only raw files (no table rows) isn't a session on its own.
      .filter(([, d]) => d.groups.size > 0)
      .map(([date, d]) => ({
        date,
        raw: d.raw,
        detail: [...d.groups.entries()]
          .map(([group, bits]) => [group, ...bits].filter(Boolean).join(" · "))
          .filter(Boolean)
          .join(", "),
      }))
      .sort((a, b) => (a.date === UNDATED ? 1 : b.date === UNDATED ? -1 : b.date.localeCompare(a.date)));
    if (sessions.length) categories.push({ id: c.id, label: c.label, sessions });
  }
  return { athlete: { athleteUuid: athlete.athlete_uuid, name: athlete.name }, categories };
}

export class ExportSelectionError extends Error {}

/** Validates the request body; throws ExportSelectionError with a message for the coach. */
export function parseSelection(body: unknown): ExportSelection {
  if (!body || typeof body !== "object") throw new ExportSelectionError("Nothing selected");
  const b = body as Record<string, unknown>;
  const sel: ExportSelection = { all: b.all === true, raw: b.raw === true, categories: {} };
  if (b.categories != null) {
    if (typeof b.categories !== "object") throw new ExportSelectionError("Bad selection");
    for (const [k, v] of Object.entries(b.categories as Record<string, unknown>)) {
      if (!isCategoryId(k)) throw new ExportSelectionError(`Unknown data type: ${k}`);
      if (v === "all") sel.categories![k] = "all";
      else if (Array.isArray(v) && v.every((d) => typeof d === "string" && (DATE_RE.test(d) || d === UNDATED))) {
        if (v.length) sel.categories![k] = [...new Set(v as string[])];
      } else throw new ExportSelectionError(`Bad dates for ${k}`);
    }
  }
  if (!sel.all && !Object.keys(sel.categories!).length) throw new ExportSelectionError("Pick at least one session or data type");
  return sel;
}

function slug(s: string): string {
  return s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") || "athlete";
}

function fileStem(row: Row, i: number): string {
  const d = row.session_date instanceof Date ? row.session_date.toISOString().slice(0, 10) : String(row.session_date ?? UNDATED).slice(0, 10);
  return `${d}_trial${row.trial_index ?? i + 1}`;
}

export interface ExportFile {
  filename: string;
  zip: Buffer;
  files: number;
}

export async function buildExport(athleteUuid: string, sel: ExportSelection, now = new Date()): Promise<ExportFile | null> {
  const athlete = await prisma.d_athletes.findUnique({ where: { athlete_uuid: athleteUuid }, select: { name: true } });
  if (!athlete) return null;
  const conn = await getDb();
  const exists = await existingTables(allParts().map((p) => p.table));
  const root = `${slug(athlete.name)}_data_${now.toISOString().slice(0, 10)}`;
  const entries: ZipEntry[] = [];
  const manifest: string[] = [];

  const wanted: Array<[ExportCategory, string[] | "all"]> = EXPORT_CATEGORIES
    .map((c): [ExportCategory, string[] | "all" | undefined] => [c, sel.all ? "all" : sel.categories?.[c.id]])
    .filter((x): x is [ExportCategory, string[] | "all"] => x[1] != null);

  for (const [c, dates] of wanted) {
    for (const p of c.parts) {
      if (!exists.has(p.table) || (p.raw && !sel.raw)) continue;
      const where = dates === "all" ? "" : ` AND ${dateKey(p)} = ANY($2::text[])`;
      const rows = await conn.query<Row>(
        `SELECT ${p.select ?? "*"} FROM ${p.from ?? p.table} WHERE ${athleteExpr(p)} = $1${where} ORDER BY ${p.orderBy}`,
        ...(dates === "all" ? [athleteUuid] : [athleteUuid, dates]),
      );
      if (!rows.length) continue;
      if (p.raw) {
        const drop = new Set(p.drop ?? []);
        rows.forEach((r, i) => {
          const clean = Object.fromEntries(Object.entries(r).filter(([k]) => !drop.has(k)).map(([k, v]) => [k, jsonValue(v)]));
          entries.push({ name: `${root}/${c.folder}/${p.file}/${fileStem(r, i)}.json`, data: JSON.stringify(clean) });
        });
        manifest.push(`${c.folder}/${p.file}/  ${rows.length} JSON file${rows.length === 1 ? "" : "s"} (one per trial)`);
      } else {
        entries.push({ name: `${root}/${c.folder}/${p.file}`, data: rowsToCsv(rows, { drop: p.drop, flatten: p.flatten }) });
        manifest.push(`${c.folder}/${p.file}  ${rows.length} row${rows.length === 1 ? "" : "s"}`);
      }
    }
  }
  if (!entries.length) return { filename: `${root}.zip`, zip: Buffer.alloc(0), files: 0 };

  const picked = sel.all
    ? "Everything on file"
    : wanted.map(([c, d]) => `${c.label}: ${d === "all" ? "all dates" : d.join(", ")}`).join("\r\n  ");
  const readme = [
    `${athlete.name} — 8ctane data export`,
    `Exported ${now.toISOString().replace("T", " ").slice(0, 16)} UTC from the coach portal.`,
    "",
    `Selection:\r\n  ${picked}${sel.raw ? "\r\n  (with raw 3D time series)" : ""}`,
    "",
    "Files:",
    ...manifest.map((m) => `  ${m}`),
    "",
    "Notes:",
    "  - One CSV per database table. Column names are the database's own; every row carries its date.",
    "  - JSON columns are split into one column per key (raw.*, metrics.*, raw_extra.*).",
    "  - TrackMan side measures (hb, rel_side, plate_loc_side) are from the pitcher's view, + = pitcher's right.",
    "    raw.* holds the original file / portal values.",
    "  - Savant columns are Statcast's own (pfx_x, plate_x and release_pos_x are from the catcher's view).",
    "  - *_kinematics.csv files are long format: one row per metric per frame.",
    "  - raw/ folders (if included) hold each trial's stored time series as JSON.",
    "",
  ].join("\r\n");
  entries.unshift({ name: `${root}/README.txt`, data: readme });
  return { filename: `${root}.zip`, zip: buildZip(entries, now), files: entries.length };
}
