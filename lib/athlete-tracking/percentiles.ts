/**
 * Percentile layer for athlete tracking.
 * Uses existing payload builders; computes percentile rank for each metric vs all other athletes.
 */

import { prisma } from "@/lib/db/prisma";
import { buildPitchingPayload } from "@/lib/octane/pitchingPayload";
import { buildHittingPayload } from "@/lib/octane/hittingPayload";
import { buildMobilityPayload } from "@/lib/octane/mobilityPayload";
import { buildAthleticScreenPayload } from "@/lib/octane/athleticScreenPayload";
import { buildArmActionPayload } from "@/lib/octane/armActionPayload";
import {
  buildProteusPitcherPayload,
  buildProteusHitterPayload,
} from "@/lib/octane/proteusPayload";
import { MOBILITY_CATEGORY_MAX } from "@/lib/octane/mobilityPayload";
import {
  computePercentileRank,
  metricKey,
} from "@/lib/athlete-tracking/percentile";
import type {
  DomainId,
  DomainWithMetrics,
  MetricWithPercentile,
} from "@/lib/athlete-tracking/types";

const POPULATION_LIMIT = 150;

type PayloadMetric = {
  category: string;
  name: string;
  value: number | null;
  valueUnit: string;
  orientation: string | null;
  mobilityMetricKind?: "GROUP" | "COMPONENT";
  mobilityGroup?: string;
  mobilityDisplayLabel?: string;
  mobilityOutOf?: number | null;
};

function attachPercentiles(
  metrics: PayloadMetric[],
  populationByKey: Map<string, Array<{ athleteUuid: string; value: number }>>,
  athleteUuid: string
): MetricWithPercentile[] {
  return metrics.map((m) => {
    const key = metricKey(m.category, m.name);
    const pop = populationByKey.get(key);
    let percentile: number | null = null;
    if (m.value !== null && Number.isFinite(m.value) && pop && pop.length > 0) {
      const values = pop.map((p) => p.value);
      percentile = computePercentileRank(
        m.value,
        values,
        m.orientation as "HIGHER_IS_BETTER" | "LOWER_IS_BETTER" | null
      );
    }
    return {
      ...m,
      percentile,
    };
  });
}

async function getAthleteUuidsWithPitching(): Promise<string[]> {
  const [fromTrials, fromKinematics] = await Promise.all([
    prisma.f_pitching_trials.findMany({
      select: { athlete_uuid: true },
      distinct: ["athlete_uuid"],
      take: POPULATION_LIMIT,
    }),
    prisma.f_kinematics_pitching.findMany({
      select: { athlete_uuid: true },
      distinct: ["athlete_uuid"],
      take: POPULATION_LIMIT,
    }),
  ]);
  const set = new Set(fromTrials.map((r) => r.athlete_uuid));
  fromKinematics.forEach((r) => set.add(r.athlete_uuid));
  return Array.from(set);
}

async function getPopulationPayloads<T>(
  uuids: string[],
  builder: (uuid: string) => Promise<{ athleteUuid: string; metrics: PayloadMetric[] }>
): Promise<Map<string, Array<{ athleteUuid: string; value: number }>>> {
  const byKey = new Map<string, Array<{ athleteUuid: string; value: number }>>();
  const batchSize = 15;
  for (let i = 0; i < uuids.length; i += batchSize) {
    const batch = uuids.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((uuid) => builder(uuid))
    );
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { athleteUuid, metrics } = result.value;
      for (const m of metrics) {
        if (m.value === null || !Number.isFinite(m.value)) continue;
        const key = metricKey(m.category, m.name);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key)!.push({ athleteUuid, value: m.value });
      }
    }
  }
  return byKey;
}

export type DomainResult = {
  metrics: MetricWithPercentile[];
  sessionDate?: string | null;
};

export async function getPitchingWithPercentiles(
  athleteUuid: string,
  sessionDate?: string
): Promise<DomainResult | null> {
  try {
    const payload = await buildPitchingPayload(athleteUuid, sessionDate);
    const uuids = await getAthleteUuidsWithPitching();
    const population = await getPopulationPayloads(uuids, async (uuid) => {
      const p = await buildPitchingPayload(uuid);
      return { athleteUuid: p.athleteUuid, metrics: p.metrics };
    });
    const metrics = attachPercentiles(payload.metrics, population, athleteUuid);
    return { metrics, sessionDate: payload.sessionDate ?? null };
  } catch {
    return null;
  }
}

async function getAthleteUuidsWithHitting(): Promise<string[]> {
  const rows = await prisma.f_kinematics_hitting.findMany({
    select: { athlete_uuid: true },
    distinct: ["athlete_uuid"],
    take: POPULATION_LIMIT,
  });
  return rows.map((r) => r.athlete_uuid);
}

export async function getHittingWithPercentiles(
  athleteUuid: string,
  sessionDate?: string
): Promise<DomainResult | null> {
  try {
    const payload = await buildHittingPayload(athleteUuid, sessionDate);
    const uuids = await getAthleteUuidsWithHitting();
    const population = await getPopulationPayloads(uuids, async (uuid) => {
      const p = await buildHittingPayload(uuid);
      return { athleteUuid: p.athleteUuid, metrics: p.metrics };
    });
    const metrics = attachPercentiles(payload.metrics, population, athleteUuid);
    return { metrics, sessionDate: payload.sessionDate ?? null };
  } catch {
    return null;
  }
}

async function getAthleteUuidsWithMobility(): Promise<string[]> {
  const rows = await prisma.f_mobility.findMany({
    select: { athlete_uuid: true },
    distinct: ["athlete_uuid"],
    take: POPULATION_LIMIT,
  });
  return rows.map((r) => r.athlete_uuid);
}

export async function getMobilityWithPercentiles(
  athleteUuid: string,
  sessionDate?: string
): Promise<DomainResult | null> {
  try {
    const payload = await buildMobilityPayload(athleteUuid, sessionDate);
    const uuids = await getAthleteUuidsWithMobility();
    const population = await getPopulationPayloads(uuids, async (uuid) => {
      const p = await buildMobilityPayload(uuid);
      return { athleteUuid: p.athleteUuid, metrics: p.metrics };
    });
    const withPercentiles = attachPercentiles(payload.metrics, population, athleteUuid);
    const maxForCategory = (name: string) => {
      const max = MOBILITY_CATEGORY_MAX[name];
      return max !== Number.POSITIVE_INFINITY ? max : null;
    };
    const metrics = withPercentiles.map((m) => {
      const keepPercentile =
        m.category === "Grip Strength" ||
        (m.mobilityMetricKind === "COMPONENT" &&
          (m.name === "shoulder_ir" || m.name === "shoulder_er"));
      const noPercentile = keepPercentile ? m : { ...m, percentile: null };
      return {
        ...noPercentile,
        max: m.mobilityMetricKind === "GROUP" ? maxForCategory(m.category) : null,
      };
    });
    return { metrics, sessionDate: payload.sessionDate ?? null };
  } catch {
    return null;
  }
}

async function getAthleteUuidsWithAthleticScreen(): Promise<string[]> {
  const rows = await prisma.f_athletic_screen_cmj.findMany({
    select: { athlete_uuid: true },
    distinct: ["athlete_uuid"],
    take: POPULATION_LIMIT,
  });
  return rows.map((r) => r.athlete_uuid);
}

export async function getAthleticScreenWithPercentiles(
  athleteUuid: string,
  sessionDate?: string
): Promise<DomainResult | null> {
  try {
    const payload = await buildAthleticScreenPayload(athleteUuid, sessionDate);
    const uuids = await getAthleteUuidsWithAthleticScreen();
    const population = await getPopulationPayloads(uuids, async (uuid) => {
      const p = await buildAthleticScreenPayload(uuid);
      return { athleteUuid: p.athleteUuid, metrics: p.metrics };
    });
    const metrics = attachPercentiles(payload.metrics, population, athleteUuid);
    return { metrics, sessionDate: payload.sessionDate ?? null };
  } catch {
    return null;
  }
}

async function getAthleteUuidsWithArmAction(): Promise<string[]> {
  const rows = await prisma.f_arm_action.findMany({
    select: { athlete_uuid: true },
    distinct: ["athlete_uuid"],
    take: POPULATION_LIMIT,
  });
  return rows.map((r) => r.athlete_uuid);
}

export async function getArmActionWithPercentiles(
  athleteUuid: string,
  sessionDate?: string
): Promise<DomainResult | null> {
  try {
    const payload = await buildArmActionPayload(athleteUuid, sessionDate);
    const uuids = await getAthleteUuidsWithArmAction();
    const population = await getPopulationPayloads(uuids, async (uuid) => {
      const p = await buildArmActionPayload(uuid);
      return { athleteUuid: p.athleteUuid, metrics: p.metrics };
    });
    const metrics = attachPercentiles(payload.metrics, population, athleteUuid);
    return { metrics, sessionDate: payload.sessionDate ?? null };
  } catch {
    return null;
  }
}

/** Proteus: try pitcher first, then hitter; use matching population. */
export async function getProteusWithPercentiles(
  athleteUuid: string,
  sessionDate?: string
): Promise<DomainResult | null> {
  try {
    const payload = await buildProteusPitcherPayload(athleteUuid, sessionDate);
    const uuids = await prisma.f_proteus.findMany({
      where: {
        position: "Pitcher",
        OR: [
          { movement: { contains: "Shot Put", mode: "insensitive" } },
          { movement: { contains: "D2 Extension", mode: "insensitive" } },
        ],
      },
      select: { athlete_uuid: true },
      distinct: ["athlete_uuid"],
      take: POPULATION_LIMIT,
    }).then((r) => r.map((x) => x.athlete_uuid));
    const population = await getPopulationPayloads(uuids, async (uuid) => {
      const p = await buildProteusPitcherPayload(uuid);
      return { athleteUuid: p.athleteUuid, metrics: p.metrics };
    });
    const metrics = attachPercentiles(payload.metrics, population, athleteUuid);
    return { metrics, sessionDate: payload.sessionDate ?? null };
  } catch {
    try {
      const payload = await buildProteusHitterPayload(athleteUuid, sessionDate);
      const uuids = await prisma.f_proteus.findMany({
        where: {
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
        select: { athlete_uuid: true },
        distinct: ["athlete_uuid"],
        take: POPULATION_LIMIT,
      }).then((r) => r.map((x) => x.athlete_uuid));
      const population = await getPopulationPayloads(uuids, async (uuid) => {
        const p = await buildProteusHitterPayload(uuid);
        return { athleteUuid: p.athleteUuid, metrics: p.metrics };
      });
      const metrics = attachPercentiles(payload.metrics, population, athleteUuid);
      return { metrics, sessionDate: payload.sessionDate ?? null };
    } catch {
      return null;
    }
  }
}

const DOMAIN_LABELS: Record<DomainId, string> = {
  pitching: "Pitching",
  hitting: "Hitting",
  mobility: "Mobility",
  athleticScreen: "Athletic Screen",
  armAction: "Arm Action",
  proteus: "Proteus",
};

type ReportCounts = {
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

const DOMAIN_COUNT_KEYS: Record<DomainId, keyof ReportCounts> = {
  pitching: "kinematicsPitching",
  hitting: "kinematicsHitting",
  mobility: "mobility",
  athleticScreen: "athleticScreen",
  armAction: "armAction",
  proteus: "proteus",
};

export async function buildDomainsWithPercentiles(
  athleteUuid: string,
  counts: ReportCounts,
  sessionDates?: Partial<Record<DomainId, string>>
): Promise<DomainWithMetrics[]> {
  const domainBuilders: Array<{
    domainId: DomainId;
    build: () => Promise<DomainResult | null>;
  }> = [
    {
      domainId: "pitching",
      build: () => getPitchingWithPercentiles(athleteUuid, sessionDates?.pitching),
    },
    {
      domainId: "hitting",
      build: () => getHittingWithPercentiles(athleteUuid, sessionDates?.hitting),
    },
    {
      domainId: "mobility",
      build: () => getMobilityWithPercentiles(athleteUuid, sessionDates?.mobility),
    },
    {
      domainId: "athleticScreen",
      build: () => getAthleticScreenWithPercentiles(athleteUuid, sessionDates?.athleticScreen),
    },
    {
      domainId: "armAction",
      build: () => getArmActionWithPercentiles(athleteUuid, sessionDates?.armAction),
    },
    {
      domainId: "proteus",
      build: () => getProteusWithPercentiles(athleteUuid, sessionDates?.proteus),
    },
  ];

  const results: DomainWithMetrics[] = [];
  for (const { domainId, build } of domainBuilders) {
    const count = counts[DOMAIN_COUNT_KEYS[domainId]];
    if (count === 0) continue;
    const result = await build();
    if (result && result.metrics.length > 0) {
      results.push({
        domainId,
        label: DOMAIN_LABELS[domainId],
        metrics: result.metrics,
        sessionDate: result.sessionDate ?? undefined,
      });
    }
  }
  return results;
}
