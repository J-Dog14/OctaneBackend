import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/responses";
import { decimalToNumber, deriveLevelFromAthlete } from "@/lib/octane/utils";

type Orientation = "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";
type ValueUnit = "NUMBER" | "DEGREES" | "DEGREES_PER_SECOND";

export type ArmActionPayloadMetric = {
  category: string;
  name: string;
  value: number | null;
  valueUnit: ValueUnit | string;
  orientation: Orientation | string | null;
};

export type ArmActionPayload = {
  athleteUuid: string;
  level: string;
  score: number | null;
  metrics: ArmActionPayloadMetric[];
  sessionDate?: string | null;
};

const ARM_ACTION_SPECS = [
  { name: "Score", valueUnit: "NUMBER", orientation: "HIGHER_IS_BETTER", key: "score" },
  { name: "Abduction", valueUnit: "DEGREES", orientation: "HIGHER_IS_BETTER", key: "arm_abduction_at_footplant" },
  { name: "Max Abduction", valueUnit: "DEGREES", orientation: "HIGHER_IS_BETTER", key: "max_abduction" },
  { name: "Timing angle", valueUnit: "DEGREES", orientation: "HIGHER_IS_BETTER", key: "shoulder_angle_at_footplant" },
  { name: "MER", valueUnit: "DEGREES", orientation: "HIGHER_IS_BETTER", key: "max_er" },
  { name: "Arm Velo", valueUnit: "DEGREES_PER_SECOND", orientation: "HIGHER_IS_BETTER", key: "arm_velo" },
  { name: "Torso Velo", valueUnit: "DEGREES_PER_SECOND", orientation: "HIGHER_IS_BETTER", key: "max_torso_rot_velo" },
  { name: "Torso Angle @ FP", valueUnit: "DEGREES", orientation: "HIGHER_IS_BETTER", key: "torso_angle_at_footplant" },
] as const;

export async function buildArmActionPayload(
  athleteUuid: string,
  sessionDate?: string
): Promise<ArmActionPayload> {
  const athlete = await prisma.d_athletes.findUnique({
    where: { athlete_uuid: athleteUuid },
    select: { athlete_uuid: true, age_group: true },
  });

  if (!athlete) {
    throw notFound("Athlete not found");
  }

  const row = await prisma.f_arm_action.findFirst({
    where: {
      athlete_uuid: athleteUuid,
      ...(sessionDate ? { session_date: new Date(sessionDate) } : {}),
    },
    orderBy: { session_date: "desc" },
    select: {
      session_date: true,
      score: true,
      arm_abduction_at_footplant: true,
      max_abduction: true,
      shoulder_angle_at_footplant: true,
      max_er: true,
      arm_velo: true,
      max_torso_rot_velo: true,
      torso_angle_at_footplant: true,
    },
  });

  if (!row) {
    throw notFound("No arm action data found for athlete");
  }

  const metrics: ArmActionPayloadMetric[] = ARM_ACTION_SPECS.map((spec) => ({
    category: "ARM_ACTION",
    name: spec.name,
    value: decimalToNumber(row[spec.key]),
    valueUnit: spec.valueUnit,
    orientation: spec.orientation,
  }));

  const sessionDateStr = row.session_date.toISOString().split("T")[0];
  return {
    athleteUuid: athlete.athlete_uuid,
    level: deriveLevelFromAthlete({ age_group: athlete.age_group ?? null }),
    score: decimalToNumber(row.score),
    metrics,
    sessionDate: sessionDateStr,
  };
}
