/**
 * Live athletic screen report: same pages as pdf_report.py, built from the
 * warehouse on request so new screens show up without regenerating a PDF.
 * Population = everyone in the database who did the movement; female athletes
 * compare against females only (pdf_report.query_population_data behavior).
 */

import { definePopulation } from "@/lib/percentiles/populations";
import { prisma } from "@/lib/db/prisma";
import { buildMovementPage, MOVEMENTS, population, type MovementPage, type Movement, type Row } from "./compute";

const TABLE: Record<Movement, string> = {
  CMJ: "public.f_athletic_screen_cmj",
  DJ: "public.f_athletic_screen_dj",
  PPU: "public.f_athletic_screen_ppu",
  SLV: "public.f_athletic_screen_slv",
};

/** [column, alias] pairs read for every movement; DJ adds CT/RSI and SLV adds side. */
const NUMERIC_COLS: Array<[string, string]> = [
  ["jh_in", "JH_IN"], ["pp_w_per_kg", "PP_W_per_kg"], ["pp_forceplate", "PP_FORCEPLATE"], ["force_at_pp", "Force_at_PP"],
  ["vel_at_pp", "Vel_at_PP"], ["auc_j", "auc_j"], ["kurtosis", "kurtosis"], ["rpd_max_w_per_s", "rpd_max_w_per_s"],
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

async function powerCurves(athleteUuid: string, date: string): Promise<Map<string, number[]>> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ movement: string; trial_name: string; power_w: number[] }>>(
      `SELECT movement, trial_name, power_w::float8[] AS power_w FROM public.f_athletic_screen_power_curve WHERE athlete_uuid = $1 AND session_date = $2::date`,
      athleteUuid,
      date,
    );
    return new Map(rows.map((r) => [`${r.movement}|${r.trial_name}`, r.power_w]));
  } catch (err) {
    if (/does not exist/.test(String(err))) return new Map();
    throw err;
  }
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
