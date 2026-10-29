/**
 * Live athletic screen report: same pages as pdf_report.py, built from the
 * warehouse on request so new screens show up without regenerating a PDF.
 * Population = everyone in the database who did the movement; female athletes
 * compare against females only (pdf_report.query_population_data behavior).
 */

import { definePopulation } from "@/lib/percentiles/populations";
import { prisma } from "@/lib/db/prisma";
import { buildMovementPage, MOVEMENTS, population, type MovementPage, type Movement, type Row } from "./compute";

/** Athletic Screen v2 through the compat views (old column names). Never the old f_athletic_screen_* tables. */
const TABLE: Record<Movement, string> = {
  CMJ: "public.v_athletic_screen_cmj",
  DJ: "public.v_athletic_screen_dj",
  PPU: "public.v_athletic_screen_ppu",
  SLV: "public.v_athletic_screen_slv",
};
const CURVE_TABLE = "public.f_athletic_screen_v2_force_curve";
const G = 9.81;

/** [column, alias] pairs read for every movement; DJ adds CT/RSI and SLV adds side. */
const NUMERIC_COLS: Array<[string, string]> = [
  ["jh_in", "JH_IN"], ["pp_w_per_kg", "PP_W_per_kg"], ["pp_forceplate", "PP_FORCEPLATE"], ["force_at_pp", "Force_at_PP"],
  ["vel_at_pp_m_s", "Vel_at_PP"], ["auc_j", "auc_j"], ["kurtosis", "kurtosis"], ["rpd_max_w_per_s", "rpd_max_w_per_s"],
  ["time_to_rpd_max_s", "time_to_rpd_max_s"],
];

function cols(m: Movement, alias = ""): string {
  const numeric = [...NUMERIC_COLS, ...(m === "DJ" ? ([["ct", "CT"], ["rsi", "RSI"]] as Array<[string, string]>) : [])];
  const list = numeric.map(([c, a]) => `${alias}${c}::float8 AS "${a}"`);
  if (m === "SLV") list.push(`${alias}side AS side`);
  return list.join(", ");
}

export interface AthleticScreenReport {
  athlete: { athleteUuid: string; name: string; gender: string | null };
  sessionDate: string;
  sessions: string[];
  pages: MovementPage[];
  /** Movements with no stored power curve for this session (shown as a note). */
  missingCurves: Movement[];
  populationNote: string;
}

export async function listScreenSessions(athleteUuid: string): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ d: string }>>(
    MOVEMENTS.map((m) => `SELECT session_date::text AS d FROM ${TABLE[m]} WHERE athlete_uuid = $1`).join(" UNION ") + " ORDER BY d DESC",
    athleteUuid,
  );
  return rows.map((r) => r.d);
}

const populations = new Map<string, () => Promise<Row[]>>();
for (const movement of MOVEMENTS) {
  for (const femaleOnly of [false, true]) {
    populations.set(`${movement}:${femaleOnly}`, definePopulation(
      `coach-screen-${movement}-${femaleOnly ? "female" : "all"}-v1`,
      async () => {
        const join = femaleOnly ? ` JOIN analytics.d_athletes da ON da.athlete_uuid = t.athlete_uuid AND da.gender = 'Female'` : "";
        return prisma.$queryRawUnsafe<Row[]>(`SELECT ${cols(movement, "t.")} FROM ${TABLE[movement]} t${join} WHERE t.jh_in IS NOT NULL`);
      },
      () => [] as Row[],
    ));
  }
}
const getPopulation = (movement: Movement, femaleOnly: boolean) => populations.get(`${movement}:${femaleOnly}`)!();

interface CurveRow {
  movement: string;
  trial_name: string;
  fs_hz: number;
  fz_n: number[];
  bw_n: number | null;
  takeoff_idx: number | null;
  landing_idx: number | null;
  contact_start_idx: number | null;
  movement_onset_idx: number | null;
}

/**
 * Power (W) from one stored v2 force curve, same as athleticScreen/v2/report_data.py: velocity is rebuilt by
 * integrating backward from takeoff (v_takeoff = g * flight / 2), and power = Fz * v from movement onset (or
 * contact start) to takeoff.
 */
export function powerFromCurve(r: CurveRow): number[] {
  const fz = r.fz_n;
  const fs = Number(r.fs_hz);
  const bw = Number(r.bw_n);
  const to = Number(r.takeoff_idx);
  const ld = Number(r.landing_idx);
  if (!(bw > 0) || !(to > 0) || !(ld > to) || !(fs > 0) || to > fz.length) return [];
  const m = bw / G;
  const v = new Array<number>(to);
  let acc = G * (ld - to) / fs / 2; // takeoff velocity
  for (let i = to - 1; i >= 0; i--) {
    acc -= (fz[i]! - bw) / m / fs;
    v[i] = acc;
  }
  const onset = r.movement_onset_idx;
  let start = onset != null && onset >= 0 ? onset : Number(r.contact_start_idx ?? 0);
  start = Math.max(0, Math.min(start, to - 1));
  const out: number[] = [];
  for (let i = start; i < to; i++) out.push(fz[i]! * v[i]!);
  return out;
}

async function powerCurves(athleteUuid: string, date: string): Promise<Map<string, number[]>> {
  const rows = await prisma.$queryRawUnsafe<CurveRow[]>(
    `SELECT movement, trial_name, fs_hz::float8 AS fs_hz, fz_n::float8[] AS fz_n, bw_n::float8 AS bw_n,
            takeoff_idx, landing_idx, contact_start_idx, movement_onset_idx
       FROM ${CURVE_TABLE} WHERE athlete_uuid = $1 AND session_date = $2::date`,
    athleteUuid,
    date,
  );
  const out = new Map<string, number[]>();
  for (const r of rows) {
    const p = powerFromCurve(r);
    if (p.length) out.set(`${r.movement.toUpperCase()}|${r.trial_name}`, p);
  }
  return out;
}

/** Null when the athlete has no screens. */
export async function buildAthleticScreenReport(athleteUuid: string, date?: string | null): Promise<AthleticScreenReport | null> {
  const sessions = await listScreenSessions(athleteUuid);
  if (!sessions.length) return null;
  const sessionDate = date && sessions.includes(date) ? date : sessions[0]!;

  const athlete = await prisma.d_athletes.findUnique({ where: { athlete_uuid: athleteUuid }, select: { name: true, gender: true } });
  if (!athlete) return null;
  const femaleOnly = (athlete.gender ?? "").toLowerCase() === "female";

  const [curves, ...perMovement] = await Promise.all([
    powerCurves(athleteUuid, sessionDate),
    ...MOVEMENTS.map(async (m) => {
      const rows = await prisma.$queryRawUnsafe<Row[]>(
        `SELECT trial_name AS trial, ${cols(m)} FROM ${TABLE[m]} WHERE athlete_uuid = $1 AND session_date = $2::date ORDER BY trial_name`,
        athleteUuid,
        sessionDate,
      );
      if (!rows.length) return null;
      const pop = await getPopulation(m, femaleOnly);
      return { m, rows, pop };
    }),
  ]);

  const pages: MovementPage[] = [];
  const missingCurves: Movement[] = [];
  for (const entry of perMovement) {
    if (!entry) continue;
    const byTrial = new Map<string, number[]>();
    for (const [k, v] of curves) if (k.startsWith(`${entry.m}|`)) byTrial.set(k.slice(entry.m.length + 1), v);
    const page = buildMovementPage(entry.m, entry.rows, population(entry.pop), byTrial);
    if (!page) continue;
    if (!page.power) missingCurves.push(entry.m);
    pages.push(page);
  }

  return {
    athlete: { athleteUuid, name: athlete.name, gender: athlete.gender ?? null },
    sessionDate,
    sessions,
    pages,
    missingCurves,
    populationNote: femaleOnly ? "Compared against female athletes in the database." : "Compared against everyone in the database who did the movement.",
  };
}
