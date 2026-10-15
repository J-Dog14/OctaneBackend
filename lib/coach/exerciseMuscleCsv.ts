/**
 * CSV round trip for the exercise → muscle mapping (coach.exercise_muscles).
 * Download every 8ctane app exercise with its current mapping, fix it in a
 * spreadsheet, upload it back. Muscles are separated by ";" and may be written
 * as ids (rear_delts) or names ("Rear delts", "hams", "glute med").
 */

import { MUSCLES, MUSCLE_IDS, type MuscleId } from "@/lib/coach/programMuscles";

export const CSV_COLUMNS = ["exercise_name", "type", "times_prescribed", "primary_muscles", "secondary_muscles", "mapping_source", "notes"] as const;

const SYNONYMS: Record<string, MuscleId> = {
  shoulders: "front_delts", shoulder: "front_delts", delts: "front_delts", "front delts": "front_delts", "side delts": "front_delts", deltoids: "front_delts",
  "rear delt": "rear_delts", "posterior delts": "rear_delts", cuff: "rotator_cuff", "rotator cuff": "rotator_cuff",
  pecs: "chest", pec: "chest", bicep: "biceps", tricep: "triceps", forearm: "forearms", grip: "forearms",
  core: "abs", abdominals: "abs", "rectus abdominis": "abs", oblique: "obliques", lat: "lats", "latissimus dorsi": "lats",
  "upper back": "upper_back", rhomboids: "upper_back", "mid back": "upper_back", "lower back": "lower_back", erectors: "lower_back",
  glute: "glutes", "glute max": "glutes", "gluteus maximus": "glutes", "glute med": "abductors", "gluteus medius": "abductors", abductor: "abductors",
  adductor: "adductors", groin: "adductors", "hip flexor": "hip_flexors", "hip flexors": "hip_flexors", psoas: "hip_flexors",
  quad: "quads", quadriceps: "quads", hamstring: "hamstrings", hams: "hamstrings", calf: "calves", trap: "traps", trapezius: "traps",
};

const BY_LABEL = new Map<string, MuscleId>([
  ...MUSCLE_IDS.map((m) => [m.replace(/_/g, " "), m] as [string, MuscleId]),
  ...MUSCLE_IDS.map((m) => [MUSCLES[m].toLowerCase(), m] as [string, MuscleId]),
  ...Object.entries(SYNONYMS),
]);

export function parseMuscles(cell: string): { ids: MuscleId[]; unknown: string[] } {
  const ids: MuscleId[] = [];
  const unknown: string[] = [];
  for (const raw of cell.split(/[;|,]/)) {
    const t = raw.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
    if (!t || t === "none" || t === "-") continue;
    const asId = t.replace(/ /g, "_");
    const id = BY_LABEL.get(t) ?? BY_LABEL.get(t.replace(/s$/, "")) ?? ((MUSCLE_IDS as string[]).includes(asId) ? (asId as MuscleId) : undefined);
    if (id) {
      if (!ids.includes(id)) ids.push(id);
    } else unknown.push(raw.trim());
  }
  return { ids, unknown };
}

export function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180-ish parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export interface MappingUpload {
  rows: Array<{ name: string; primary: MuscleId[]; secondary: MuscleId[]; notes: string | null }>;
  errors: Array<{ line: number; message: string }>;
  skipped: number;
}

/**
 * Rows with at least one muscle become overrides; "none" in primary_muscles stores
 * an explicit "no muscles" (mobility drill); rows with both columns blank are skipped.
 */
export function readMappingCsv(text: string): MappingUpload {
  const table = parseCsv(text);
  const out: MappingUpload = { rows: [], errors: [], skipped: 0 };
  if (!table.length) return { ...out, errors: [{ line: 1, message: "The file is empty." }] };
  const head = table[0]!.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (n: string) => head.indexOf(n);
  const iName = col("exercise_name") >= 0 ? col("exercise_name") : col("exercise") >= 0 ? col("exercise") : col("name");
  const iP = col("primary_muscles") >= 0 ? col("primary_muscles") : col("primary");
  const iS = col("secondary_muscles") >= 0 ? col("secondary_muscles") : col("secondary");
  const iN = col("notes");
  if (iName < 0 || iP < 0) return { ...out, errors: [{ line: 1, message: "Need columns exercise_name and primary_muscles (secondary_muscles optional)." }] };
  const seen = new Set<string>();
  table.slice(1).forEach((r, k) => {
    const line = k + 2;
    const name = (r[iName] ?? "").trim();
    if (!name) return;
    const pCell = (r[iP] ?? "").trim();
    const sCell = iS >= 0 ? (r[iS] ?? "").trim() : "";
    if (!pCell && !sCell) { out.skipped++; return; }
    const p = parseMuscles(pCell);
    const s = parseMuscles(sCell);
    const bad = [...p.unknown, ...s.unknown];
    if (bad.length) { out.errors.push({ line, message: `${name}: unknown muscle ${bad.map((b) => `"${b}"`).join(", ")}` }); return; }
    const key = name.toLowerCase();
    if (seen.has(key)) { out.errors.push({ line, message: `${name}: listed twice (kept the first)` }); return; }
    seen.add(key);
    out.rows.push({ name, primary: p.ids, secondary: s.ids.filter((m) => !p.ids.includes(m)), notes: iN >= 0 ? (r[iN] ?? "").trim() || null : null });
  });
  return out;
}
