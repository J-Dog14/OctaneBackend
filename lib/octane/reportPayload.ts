import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/responses";

export type AthleteReportPayload = {
  generatedAt: string;
  athlete: {
    athleteUuid: string;
    name: string;
    dateOfBirth?: string | null;
    gender?: string | null;
    height?: string | null;
    weight?: string | null;
    email?: string | null;
    /** Octane app user UUID when resolved (matched via email). */
    octaneAppUuid?: string | null;
  };
  counts: {
    armAction: number;
    athleticScreen: number;
    mobility: number;
    proSup: number;
    proteus: number;
    readinessScreen: number;
    kinematicsPitching: number;
    kinematicsHitting: number;
    curveballTest: number;
  };
};

export async function buildAthleteReportPayload(
  athleteUuid: string
): Promise<AthleteReportPayload> {
  const athlete = await prisma.d_athletes.findUnique({
    where: { athlete_uuid: athleteUuid },
    select: {
      athlete_uuid: true,
      name: true,
      date_of_birth: true,
      gender: true,
      height: true,
      weight: true,
      email: true,
      app_db_uuid: true,
    },
  });

  if (!athlete) {
    throw notFound("Athlete not found");
  }

  const [counts] = await prisma.$queryRaw<
    [
      {
        arm_action: bigint;
        athletic_screen_legacy: bigint;
        athletic_screen_cmj: bigint;
        athletic_screen_dj: bigint;
        athletic_screen_ppu: bigint;
        athletic_screen_slv: bigint;
        mobility: bigint;
        pro_sup: bigint;
        proteus: bigint;
        readiness_screen: bigint;
        pitching_trials: bigint;
        kinematics_pitching: bigint;
        kinematics_hitting: bigint;
        curveball_test: bigint;
      },
    ]
  >`
    SELECT
      (SELECT COUNT(*) FROM public.f_arm_action            WHERE athlete_uuid = ${athleteUuid})::int AS arm_action,
      (SELECT COUNT(*) FROM public.f_athletic_screen        WHERE athlete_uuid = ${athleteUuid})::int AS athletic_screen_legacy,
      (SELECT COUNT(*) FROM public.f_athletic_screen_cmj    WHERE athlete_uuid = ${athleteUuid})::int AS athletic_screen_cmj,
      (SELECT COUNT(*) FROM public.f_athletic_screen_dj     WHERE athlete_uuid = ${athleteUuid})::int AS athletic_screen_dj,
      (SELECT COUNT(*) FROM public.f_athletic_screen_ppu    WHERE athlete_uuid = ${athleteUuid})::int AS athletic_screen_ppu,
      (SELECT COUNT(*) FROM public.f_athletic_screen_slv    WHERE athlete_uuid = ${athleteUuid})::int AS athletic_screen_slv,
      (SELECT COUNT(*) FROM public.f_mobility               WHERE athlete_uuid = ${athleteUuid})::int AS mobility,
      (SELECT COUNT(*) FROM public.f_pro_sup                WHERE athlete_uuid = ${athleteUuid})::int AS pro_sup,
      (SELECT COUNT(*) FROM public.f_proteus                WHERE athlete_uuid = ${athleteUuid})::int AS proteus,
      (SELECT COUNT(*) FROM public.f_readiness_screen       WHERE athlete_uuid = ${athleteUuid})::int AS readiness_screen,
      (SELECT COUNT(*) FROM public.f_pitching_trials        WHERE athlete_uuid = ${athleteUuid})::int AS pitching_trials,
      (SELECT COUNT(*) FROM public.f_kinematics_pitching    WHERE athlete_uuid = ${athleteUuid})::int AS kinematics_pitching,
      (SELECT COUNT(*) FROM public.f_kinematics_hitting     WHERE athlete_uuid = ${athleteUuid})::int AS kinematics_hitting,
      (SELECT COUNT(*) FROM public.f_curveball_test         WHERE athlete_uuid = ${athleteUuid})::int AS curveball_test
  `;

  return {
    generatedAt: new Date().toISOString(),
    athlete: {
      athleteUuid: athlete.athlete_uuid,
      name: athlete.name,
      dateOfBirth: athlete.date_of_birth?.toISOString() ?? null,
      gender: athlete.gender ?? null,
      height: athlete.height ? String(athlete.height) : null,
      weight: athlete.weight ? String(athlete.weight) : null,
      email: athlete.email ?? null,
      octaneAppUuid: athlete.app_db_uuid ?? null,
    },
    counts: {
      armAction:          Number(counts.arm_action),
      athleticScreen:     Number(counts.athletic_screen_legacy) + Number(counts.athletic_screen_cmj) + Number(counts.athletic_screen_dj) + Number(counts.athletic_screen_ppu) + Number(counts.athletic_screen_slv),
      mobility:           Number(counts.mobility),
      proSup:             Number(counts.pro_sup),
      proteus:            Number(counts.proteus),
      readinessScreen:    Number(counts.readiness_screen),
      kinematicsPitching: Number(counts.pitching_trials) + Number(counts.kinematics_pitching),
      kinematicsHitting:  Number(counts.kinematics_hitting),
      curveballTest:      Number(counts.curveball_test),
    },
  };
}

