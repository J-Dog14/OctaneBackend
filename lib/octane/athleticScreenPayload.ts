import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/responses";
import { decimalToNumber, deriveLevelFromAthlete } from "@/lib/octane/utils";

function avgNullable(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  return valid.length > 0 ? valid.reduce((a, b) => a + b) / valid.length : null;
}

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

  const [cmjRows, djRows, ppuRows, slvRows] = await Promise.all([
    prisma.f_athletic_screen_cmj.findMany({
      where: { athlete_uuid: athleteUuid, session_date: resolvedSessionDate },
      select: {
        jh_in: true,
        pp_w_per_kg: true,
        auc_j: true,
        kurtosis: true,
        rpd_max_w_per_s: true,
        time_to_rpd_max_s: true,
      },
    }),
    prisma.f_athletic_screen_dj.findMany({
      where: { athlete_uuid: athleteUuid, session_date: resolvedSessionDate },
      select: {
        jh_in: true,
        pp_w_per_kg: true,
        auc_j: true,
        kurtosis: true,
        rpd_max_w_per_s: true,
        time_to_rpd_max_s: true,
        rsi: true,
        ct: true,
      },
    }),
    prisma.f_athletic_screen_ppu.findMany({
      where: { athlete_uuid: athleteUuid, session_date: resolvedSessionDate },
      select: {
        jh_in: true,
        pp_w_per_kg: true,
        auc_j: true,
        kurtosis: true,
        rpd_max_w_per_s: true,
        time_to_rpd_max_s: true,
      },
    }),
    prisma.f_athletic_screen_slv.findMany({
      where: { athlete_uuid: athleteUuid, session_date: resolvedSessionDate },
      select: {
        side: true,
        jh_in: true,
        pp_w_per_kg: true,
        auc_j: true,
        kurtosis: true,
        rpd_max_w_per_s: true,
        time_to_rpd_max_s: true,
      },
    }),
  ]);

  const cmjRow = cmjRows.length > 0 ? {
    jh_in: avgNullable(cmjRows.map((r) => decimalToNumber(r.jh_in))),
    pp_w_per_kg: avgNullable(cmjRows.map((r) => decimalToNumber(r.pp_w_per_kg))),
    auc_j: avgNullable(cmjRows.map((r) => decimalToNumber(r.auc_j))),
    kurtosis: avgNullable(cmjRows.map((r) => decimalToNumber(r.kurtosis))),
    rpd_max_w_per_s: avgNullable(cmjRows.map((r) => decimalToNumber(r.rpd_max_w_per_s))),
    time_to_rpd_max_s: avgNullable(cmjRows.map((r) => decimalToNumber(r.time_to_rpd_max_s))),
  } : null;

  const djRow = djRows.length > 0 ? {
    jh_in: avgNullable(djRows.map((r) => decimalToNumber(r.jh_in))),
    pp_w_per_kg: avgNullable(djRows.map((r) => decimalToNumber(r.pp_w_per_kg))),
    auc_j: avgNullable(djRows.map((r) => decimalToNumber(r.auc_j))),
    kurtosis: avgNullable(djRows.map((r) => decimalToNumber(r.kurtosis))),
    rpd_max_w_per_s: avgNullable(djRows.map((r) => decimalToNumber(r.rpd_max_w_per_s))),
    time_to_rpd_max_s: avgNullable(djRows.map((r) => decimalToNumber(r.time_to_rpd_max_s))),
    rsi: avgNullable(djRows.map((r) => decimalToNumber(r.rsi))),
    ct: avgNullable(djRows.map((r) => decimalToNumber(r.ct))),
  } : null;

  const ppuRow = ppuRows.length > 0 ? {
    jh_in: avgNullable(ppuRows.map((r) => decimalToNumber(r.jh_in))),
    pp_w_per_kg: avgNullable(ppuRows.map((r) => decimalToNumber(r.pp_w_per_kg))),
    auc_j: avgNullable(ppuRows.map((r) => decimalToNumber(r.auc_j))),
    kurtosis: avgNullable(ppuRows.map((r) => decimalToNumber(r.kurtosis))),
    rpd_max_w_per_s: avgNullable(ppuRows.map((r) => decimalToNumber(r.rpd_max_w_per_s))),
    time_to_rpd_max_s: avgNullable(ppuRows.map((r) => decimalToNumber(r.time_to_rpd_max_s))),
  } : null;

  const orientation: Orientation = "HIGHER_IS_BETTER";
  const valueUnit: ValueUnit = "NUMBER";
  const metrics: AthleticScreenPayloadMetric[] = [];

  const commonSpecs = [
    { name: "JH", key: "jh_in" as const },
    { name: "Peak Power", key: "pp_w_per_kg" as const },
    { name: "Work (AUC)", key: "auc_j" as const },
    { name: "Kurtosis", key: "kurtosis" as const },
    { name: "Max RPD", key: "rpd_max_w_per_s" as const },
    { name: "Time to Max RPD", key: "time_to_rpd_max_s" as const },
  ];

  if (cmjRow) {
    for (const { name, key } of commonSpecs) {
      metrics.push({ category: "CMJ", name, value: cmjRow[key], valueUnit, orientation });
    }
  }

  if (djRow) {
    metrics.push(
      { category: "DJ", name: "JH", value: djRow.jh_in, valueUnit, orientation },
      { category: "DJ", name: "Peak Power", value: djRow.pp_w_per_kg, valueUnit, orientation },
      { category: "DJ", name: "Work (AUC)", value: djRow.auc_j, valueUnit, orientation },
      { category: "DJ", name: "Kurtosis", value: djRow.kurtosis, valueUnit, orientation },
      { category: "DJ", name: "Max RPD", value: djRow.rpd_max_w_per_s, valueUnit, orientation },
      { category: "DJ", name: "Time to Max RPD", value: djRow.time_to_rpd_max_s, valueUnit, orientation },
      { category: "DJ", name: "RSI", value: djRow.rsi, valueUnit, orientation },
      { category: "DJ", name: "CT", value: djRow.ct, valueUnit, orientation },
    );
  }

  if (ppuRow) {
    for (const { name, key } of commonSpecs) {
      metrics.push({ category: "PPU", name, value: ppuRow[key], valueUnit, orientation });
    }
  }

  const normalizeSide = (s: string | null): string => {
    const t = s?.trim().toLowerCase();
    if (t === "l" || t === "left") return "Left";
    if (t === "r" || t === "right") return "Right";
    return t ? String(s).trim() : "Unknown";
  };
  const slvSpecs = [
    { name: "JH", key: "jh_in" as const },
    { name: "Peak Power", key: "pp_w_per_kg" as const },
    { name: "Work (AUC)", key: "auc_j" as const },
    { name: "Kurtosis", key: "kurtosis" as const },
    { name: "Max RPD", key: "rpd_max_w_per_s" as const },
    { name: "Time to Max RPD", key: "time_to_rpd_max_s" as const },
  ];
  // Group SLV rows by normalized side and emit one averaged entry per side.
  const slvBySide = new Map<string, typeof slvRows>();
  for (const row of slvRows ?? []) {
    const side = normalizeSide(row.side);
    if (!slvBySide.has(side)) slvBySide.set(side, []);
    slvBySide.get(side)!.push(row);
  }
  for (const [side, rows] of slvBySide) {
    const category = `SLV_${side}`;
    const avgSlv = {
      jh_in: avgNullable(rows.map((r) => decimalToNumber(r.jh_in))),
      pp_w_per_kg: avgNullable(rows.map((r) => decimalToNumber(r.pp_w_per_kg))),
      auc_j: avgNullable(rows.map((r) => decimalToNumber(r.auc_j))),
      kurtosis: avgNullable(rows.map((r) => decimalToNumber(r.kurtosis))),
      rpd_max_w_per_s: avgNullable(rows.map((r) => decimalToNumber(r.rpd_max_w_per_s))),
      time_to_rpd_max_s: avgNullable(rows.map((r) => decimalToNumber(r.time_to_rpd_max_s))),
    };
    for (const { name, key } of slvSpecs) {
      metrics.push({ category, name, value: avgSlv[key], valueUnit, orientation });
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
