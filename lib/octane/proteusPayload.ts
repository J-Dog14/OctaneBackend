import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/responses";
import { decimalToNumber, deriveLevelFromAthlete } from "@/lib/octane/utils";

type Orientation = "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";
type ValueUnit = "NUMBER";

export type ProteusPayloadMetric = {
  category: string;
  name: string;
  value: number | null;
  valueUnit: ValueUnit | string;
  orientation: Orientation | string | null;
};

export type ProteusPayload = {
  athleteUuid: string;
  level: string;
  score: number | null;
  metrics: ProteusPayloadMetric[];
  sessionDate?: string | null;
};

const PROTEUS_VARIABLES = [
  { name: "Power_high", key: "power_high" as const },
  { name: "Power_mean", key: "power_mean" as const },
  { name: "Velocity_high", key: "velocity_high" as const },
  { name: "Velocity_mean", key: "velocity_mean" as const },
  { name: "Acceleration_high", key: "acceleration_high" as const },
  { name: "Acceleration_mean", key: "acceleration_mean" as const },
] as const;

/** Pitchers: position = Pitcher, movements Shotput and D2 Extension */
export async function buildProteusPitcherPayload(
  athleteUuid: string,
  sessionDate?: string
): Promise<ProteusPayload> {
  const athlete = await prisma.d_athletes.findUnique({
    where: { athlete_uuid: athleteUuid },
    select: { athlete_uuid: true, age_group: true },
  });

  if (!athlete) {
    throw notFound("Athlete not found");
  }

  const rows = await prisma.f_proteus.findMany({
    where: {
      athlete_uuid: athleteUuid,
      position: "Pitcher",
      ...(sessionDate ? { session_date: new Date(sessionDate) } : {}),
      OR: [
        { movement: { contains: "Shot Put", mode: "insensitive" } },
        { movement: { contains: "D2 Extension", mode: "insensitive" } },
      ],
    },
    orderBy: [{ session_date: "desc" }, { created_at: "desc" }],
    select: {
      session_date: true,
      movement: true,
      power_high: true,
      power_mean: true,
      velocity_high: true,
      velocity_mean: true,
      acceleration_high: true,
      acceleration_mean: true,
    },
  });

  if (rows.length === 0) {
    throw notFound("No Proteus pitcher data found for athlete");
  }

  const latestSessionDate = rows[0].session_date;
  const sessionRows = rows.filter(
    (r) => r.session_date.getTime() === latestSessionDate.getTime()
  );

  const metrics: ProteusPayloadMetric[] = [];
  const orientation: Orientation = "HIGHER_IS_BETTER";
  const valueUnit: ValueUnit = "NUMBER";

  for (const row of sessionRows) {
    const category = row.movement ?? "Unknown";
    for (const { name, key } of PROTEUS_VARIABLES) {
      metrics.push({
        category,
        name,
        value: decimalToNumber(row[key]),
        valueUnit,
        orientation,
      });
    }
  }

  const sessionDateStr = rows[0].session_date.toISOString().split("T")[0];
  return {
    athleteUuid: athlete.athlete_uuid,
    level: deriveLevelFromAthlete({ age_group: athlete.age_group ?? null }),
    score: null,
    metrics,
    sessionDate: sessionDateStr,
  };
}

/** Hitters: all positions that are not Pitcher; movements Shot Put (Countermovement) and Straight arm trunk rotation */
export async function buildProteusHitterPayload(
  athleteUuid: string,
  sessionDate?: string
): Promise<ProteusPayload> {
  const athlete = await prisma.d_athletes.findUnique({
    where: { athlete_uuid: athleteUuid },
    select: { athlete_uuid: true, age_group: true },
  });

  if (!athlete) {
    throw notFound("Athlete not found");
  }

  const rows = await prisma.f_proteus.findMany({
    where: {
      athlete_uuid: athleteUuid,
      ...(sessionDate ? { session_date: new Date(sessionDate) } : {}),
      AND: [
        { OR: [{ position: null }, { position: { not: "Pitcher" } }] },
        {
          OR: [
            { movement: { contains: "Shot Put", mode: "insensitive" } },
            { movement: { equals: "Straight Arm Trunk Rotation", mode: "insensitive" } },
          ],
        },
      ],
    },
    orderBy: [{ session_date: "desc" }, { created_at: "desc" }],
    select: {
      session_date: true,
      movement: true,
      power_high: true,
      power_mean: true,
      velocity_high: true,
      velocity_mean: true,
      acceleration_high: true,
      acceleration_mean: true,
    },
  });

  if (rows.length === 0) {
    throw notFound("No Proteus hitter data found for athlete");
  }

  const latestSessionDate = rows[0].session_date;
  const sessionRows = rows.filter(
    (r) => r.session_date.getTime() === latestSessionDate.getTime()
  );

  const metrics: ProteusPayloadMetric[] = [];
  const orientation: Orientation = "HIGHER_IS_BETTER";
  const valueUnit: ValueUnit = "NUMBER";

  for (const row of sessionRows) {
    const category = row.movement ?? "Unknown";
    for (const { name, key } of PROTEUS_VARIABLES) {
      metrics.push({
        category,
        name,
        value: decimalToNumber(row[key]),
        valueUnit,
        orientation,
      });
    }
  }

  const sessionDateStr = rows[0].session_date.toISOString().split("T")[0];
  return {
    athleteUuid: athlete.athlete_uuid,
    level: deriveLevelFromAthlete({ age_group: athlete.age_group ?? null }),
    score: null,
    metrics,
    sessionDate: sessionDateStr,
  };
}
