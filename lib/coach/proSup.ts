/**
 * Pro-sup test report data, matching uais/python/proSupTest/main.py
 * (generate_report_from_postgres): score + three 10-second interval cards,
 * each with cumulative ROM, fatigue index, forearm ROM and a percentile ring.
 *
 * Percentiles follow the PDF: pandas rank(pct=True) × 100 (ties averaged)
 * over every f_pro_sup row with an interval ROM, the athlete's own row included.
 */

import { prisma } from "@/lib/db/prisma";
import { definePopulation } from "@/lib/percentiles/populations";

export interface ProSupInterval {
  title: string;
  cumulativeRom: number | null;
  fatigueIndex: number | null;
  forearmRom: number | null;
  percentile: number | null;
}

export interface ProSupReport {
  athlete: { athleteUuid: string; name: string };
  sessionDate: string;
  sessions: string[];
  score: number | null;
  scorePercentile: number | null;
  intervals: ProSupInterval[];
  /** For the three-bar chart on every interval card. */
  romBars: [number | null, number | null, number | null];
  populationN: number;
}

type Row = {
  athlete_uuid: string;
  d: string;
  r0: number | null; r1: number | null; r2: number | null;
  f0: number | null; f1: number | null; f2: number | null;
  fr0: number | null; fr1: number | null; fr2: number | null;
  score: number | null;
};

type PopulationRow = Pick<Row, "r0" | "r1" | "r2" | "score">;
const getPopulation = definePopulation(
  "coach-pro-sup-population-v1",
  () => prisma.$queryRawUnsafe<PopulationRow[]>(
    `SELECT tot_rom_0to10::float8 AS r0, tot_rom_10to20::float8 AS r1,
            tot_rom_20to30::float8 AS r2, total_score::float8 AS score
       FROM public.f_pro_sup WHERE tot_rom_0to10 IS NOT NULL`,
  ),
  () => [] as PopulationRow[],
);

/** pandas Series.rank(pct=True) * 100 for one value (method="average", NaNs excluded). */
export function rankPct(values: Array<number | null>, x: number | null): number | null {
  if (x == null) return null;
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!xs.length) return null;
  let below = 0;
  let equal = 0;
  for (const v of xs) {
    if (v < x) below++;
    else if (v === x) equal++;
  }
  // A new/historical value can be outside the last completed snapshot.
  return Math.min(100, ((below + (equal + 1) / 2) / xs.length) * 100);
}

export async function buildProSupReport(athleteUuid: string, date?: string | null): Promise<ProSupReport | null> {
  const [athlete, mine, all] = await Promise.all([
    prisma.d_athletes.findUnique({ where: { athlete_uuid: athleteUuid }, select: { name: true } }),
    prisma.$queryRawUnsafe<Row[]>(
      `SELECT athlete_uuid, session_date::text AS d,
              tot_rom_0to10::float8 AS r0, tot_rom_10to20::float8 AS r1, tot_rom_20to30::float8 AS r2,
              fatigue_index_10::float8 AS f0, fatigue_index_20::float8 AS f1, fatigue_index_30::float8 AS f2,
              forearm_rom_0to10::float8 AS fr0, forearm_rom_10to20::float8 AS fr1, forearm_rom_20to30::float8 AS fr2,
              total_score::float8 AS score
         FROM public.f_pro_sup
        WHERE athlete_uuid = $1 AND tot_rom_0to10 IS NOT NULL
        ORDER BY session_date DESC`,
      athleteUuid,
    ),
    getPopulation(),
  ]);
  if (!athlete) return null;
  if (!mine.length) return null;
  const sessions = [...new Set(mine.map((r) => r.d))];
  const sessionDate = date && sessions.includes(date) ? date : sessions[0]!;
  const row = mine.find((r) => r.d === sessionDate)!;

  const col = (k: keyof PopulationRow) => all.map((r) => r[k]);
  const titles = ["0–10 Seconds", "10–20 Seconds", "20–30 Seconds"];
  const rom = [row.r0, row.r1, row.r2];
  const fat = [row.f0, row.f1, row.f2];
  const fr = [row.fr0, row.fr1, row.fr2];
  const romKeys: Array<keyof PopulationRow> = ["r0", "r1", "r2"];

  return {
    athlete: { athleteUuid, name: athlete.name },
    sessionDate,
    sessions,
    score: row.score,
    scorePercentile: rankPct(col("score"), row.score),
    intervals: titles.map((title, i) => ({
      title,
      cumulativeRom: rom[i] ?? null,
      fatigueIndex: fat[i] ?? null,
      forearmRom: fr[i] ?? null,
      percentile: rankPct(col(romKeys[i]!), rom[i] ?? null),
    })),
    romBars: [row.r0, row.r1, row.r2],
    populationN: all.length,
  };
}
