import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/responses";
import { decimalToNumber, deriveLevelFromAthlete } from "@/lib/octane/utils";

type Orientation = "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";
type ValueUnit = "NUMBER" | "IN" | "W" | "W_PER_KG" | "S" | "J";

export type AthleticScreenPayloadMetric = {
  category: string;
  name: string;
  value: number | null;
  valueUnit: ValueUnit | string;
  orientation: Orientation | string | null;
};

export type AthleticScreenPayload = {
  athleteUuid: string;
  level: string;
  score: number | null;
  metrics: AthleticScreenPayloadMetric[];
  sessionDate?: string | null;
};

export async function buildAthleticScreenPayload(
  athleteUuid: string,
  sessionDate?: string
): Promise<AthleticScreenPayload> {
  const athlete = await prisma.d_athletes.findUnique({
    where: { athlete_uuid: athleteUuid },
    select: { athlete_uuid: true, age_group: true },
  });

  if (!athlete) {
    throw notFound("Athlete not found");
  }

  let resolvedSessionDate: Date;
  if (sessionDate) {
    resolvedSessionDate = new Date(sessionDate);
  } else {
    const [latestCmj, latestDj, latestPpu, latestSlv] = await Promise.all([
      prisma.f_athletic_screen_cmj.findFirst({
        where: { athlete_uuid: athleteUuid },
        orderBy: [{ session_date: "desc" }, { created_at: "desc" }],
        select: { session_date: true },
      }),
      prisma.f_athletic_screen_dj.findFirst({
        where: { athlete_uuid: athleteUuid },
        orderBy: [{ session_date: "desc" }, { created_at: "desc" }],
        select: { session_date: true },
      }),
      prisma.f_athletic_screen_ppu.findFirst({
        where: { athlete_uuid: athleteUuid },
        orderBy: [{ session_date: "desc" }, { created_at: "desc" }],
        select: { session_date: true },
      }),
      prisma.f_athletic_screen_slv.findFirst({
        where: { athlete_uuid: athleteUuid },
        orderBy: [{ session_date: "desc" }, { created_at: "desc" }],
        select: { session_date: true },
      }),
    ]);

    const dates = [
      latestCmj?.session_date,
      latestDj?.session_date,
      latestPpu?.session_date,
      latestSlv?.session_date,
    ].filter((d): d is Date => d != null);

    if (dates.length === 0) {
      throw notFound("No athletic screen data found for athlete");
    }
    resolvedSessionDate = new Date(Math.max(...dates.map((d) => d.getTime())));
  }

  const [cmjRow, djRow, ppuRow, slvRows] = await Promise.all([
    prisma.f_athletic_screen_cmj.findFirst({
      where: { athlete_uuid: athleteUuid, session_date: resolvedSessionDate },
      orderBy: { created_at: "desc" },
      select: {
        jh_in: true,
        peak_power: true,
        auc_j: true,
        kurtosis: true,
        rpd_max_w_per_s: true,
        time_to_rpd_max_s: true,
      },
    }),
    prisma.f_athletic_screen_dj.findFirst({
      where: { athlete_uuid: athleteUuid, session_date: resolvedSessionDate },
      orderBy: { created_at: "desc" },
      select: {
        jh_in: true,
        peak_power: true,
        auc_j: true,
        kurtosis: true,
        rpd_max_w_per_s: true,
        time_to_rpd_max_s: true,
        rsi: true,
        ct: true,
      },
    }),
    prisma.f_athletic_screen_ppu.findFirst({
      where: { athlete_uuid: athleteUuid, session_date: resolvedSessionDate },
      orderBy: { created_at: "desc" },
      select: {
        jh_in: true,
        peak_power: true,
        auc_j: true,
        kurtosis: true,
        rpd_max_w_per_s: true,
        time_to_rpd_max_s: true,
      },
    }),
    prisma.f_athletic_screen_slv.findMany({
      where: { athlete_uuid: athleteUuid, session_date: resolvedSessionDate },
      orderBy: { created_at: "desc" },
      select: {
        side: true,
        jh_in: true,
        peak_power_w: true,
        auc_j: true,
        kurtosis: true,
        rpd_max_w_per_s: true,
        time_to_rpd_max_s: true,
      },
    }),
  ]);

  const orientation: Orientation = "HIGHER_IS_BETTER";
  const valueUnit: ValueUnit = "NUMBER";
  const metrics: AthleticScreenPayloadMetric[] = [];

  const commonSpecs = [
    { name: "JH", key: "jh_in" as const },
    { name: "PP", key: "peak_power" as const },
    { name: "Work (AUC)", key: "auc_j" as const },
    { name: "Kurtosis", key: "kurtosis" as const },
    { name: "Max RPD", key: "rpd_max_w_per_s" as const },
    { name: "Time to Max RPD", key: "time_to_rpd_max_s" as const },
  ];

  if (cmjRow) {
    for (const { name, key } of commonSpecs) {
      metrics.push({
        category: "CMJ",
        name,
        value: decimalToNumber(cmjRow[key]),
        valueUnit,
        orientation,
      });
    }
  }

  if (djRow) {
    for (const { name, key } of commonSpecs) {
      metrics.push({
        category: "DJ",
        name,
        value: decimalToNumber(djRow[key]),
        valueUnit,
        orientation,
      });
    }
    metrics.push(
      {
        category: "DJ",
        name: "RSI",
        value: decimalToNumber(djRow.rsi),
        valueUnit,
        orientation,
      },
      {
        category: "DJ",
        name: "CT",
        value: decimalToNumber(djRow.ct),
        valueUnit,
        orientation,
      }
    );
  }

  if (ppuRow) {
    for (const { name, key } of commonSpecs) {
      metrics.push({
        category: "PPU",
        name,
        value: decimalToNumber(ppuRow[key]),
        valueUnit,
        orientation,
      });
    }
  }

  const normalizeSide = (s: string | null): string => {
    const t = s?.trim().toLowerCase();
    if (t === "l" || t === "left") return "Left";
    if (t === "r" || t === "right") return "Right";
    return t ? String(s).trim() : "Unknown";
  };
  for (const row of slvRows ?? []) {
    const category = `SLV_${normalizeSide(row.side)}`;
    const slvSpecs = [
      { name: "JH", key: "jh_in" as const },
      { name: "PP", key: "peak_power_w" as const },
      { name: "Work (AUC)", key: "auc_j" as const },
      { name: "Kurtosis", key: "kurtosis" as const },
      { name: "Max RPD", key: "rpd_max_w_per_s" as const },
      { name: "Time to Max RPD", key: "time_to_rpd_max_s" as const },
    ];
    for (const { name, key } of slvSpecs) {
      metrics.push({
        category,
        name,
        value: decimalToNumber(row[key]),
        valueUnit,
        orientation,
      });
    }
  }

  const sessionDateStr = resolvedSessionDate.toISOString().split("T")[0];
  return {
    athleteUuid: athlete.athlete_uuid,
    level: deriveLevelFromAthlete({ age_group: athlete.age_group ?? null }),
    score: null,
    metrics,
    sessionDate: sessionDateStr,
  };
}
