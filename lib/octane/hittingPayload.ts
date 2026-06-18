import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/responses";
import { decimalToNumber, deriveLevelFromAthlete } from "@/lib/octane/utils";

type Orientation = "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";
type ValueUnit = "DEGREES" | "DEGREES_PER_SECOND" | "NUMBER";

export type HittingPayloadMetric = {
  category: string;
  name: string;
  value: number | null;
  valueUnit: ValueUnit | string;
  orientation: Orientation | string | null;
};

export type HittingPayload = {
  athleteUuid: string;
  level: string;
  score: number | null;
  metrics: HittingPayloadMetric[];
  sessionDate?: string | null;
};

type HittingMetricSpec = {
  category: string;
  name: string;
  valueUnit: ValueUnit;
  orientation: Orientation;
  metricNameCandidates?: string[];
  computeFromMap?: (map: Map<string, number | null>) => number | null;
};

function getFirstValue(
  map: Map<string, number | null>,
  candidates: string[]
): number | null {
  for (const key of candidates) {
    const value = map.get(key);
    if (value !== undefined) return value;
  }
  return null;
}

const HITTING_METRIC_SPECS: HittingMetricSpec[] = [
  {
    category: "PROCESSED",
    name: "Max_Pelvis_Ang_Vel",
    valueUnit: "DEGREES_PER_SECOND",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Max_Pelvis_Ang_Vel",
      "PROCESSED.Max_Pelvis_Ang_Vel_MEAN",
    ],
  },
  {
    category: "PROCESSED",
    name: "Max_Thorax_Ang_Vel",
    valueUnit: "DEGREES_PER_SECOND",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Max_Thorax_Ang_Vel",
      "PROCESSED.Max_Thorax_Ang_Vel_MEAN",
    ],
  },
  {
    category: "PROCESSED",
    name: "Max_Lead_Forearm_Ang_Vel",
    valueUnit: "DEGREES_PER_SECOND",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Max_Lead_Forearm_Ang_Vel",
      "PROCESSED.Max_Lead_Forearm_Ang_Vel_MEAN",
    ],
  },
  {
    category: "PROCESSED",
    name: "Max_Lead_Hand_Ang_Vel",
    valueUnit: "DEGREES_PER_SECOND",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Max_Lead_Hand_Ang_Vel",
      "PROCESSED.Max_Lead_Hand_Ang_Vel_MEAN",
    ],
  },
  {
    category: "PROCESSED",
    name: "Max_Bat_Ang_Vel",
    valueUnit: "DEGREES_PER_SECOND",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Max_Bat_Ang_Vel",
      "PROCESSED.Max_Bat_Ang_Vel_MEAN",
    ],
  },
  {
    category: "PLANE",
    name: "Horizontal_attack_angle",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PLANE.Horizontal_attack_angle"],
  },
  {
    category: "PLANE",
    name: "Vertical_attack_angle",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PLANE.Vertical_attack_angle"],
  },
  {
    category: "PROCESSED",
    name: "Max_RPV_CGPos_VLab_Linear_Vel",
    valueUnit: "NUMBER",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Max_RPV_CGPos_VLab_Linear_Vel",
      "PROCESSED.Max_RPV_CGPos_VLab_Linear_Vel_MEAN",
    ],
  },
  {
    category: "PROCESSED",
    name: "Max_RTA_CGPos_VLab_Linear_Vel",
    valueUnit: "NUMBER",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Max_RTA_CGPos_VLab_Linear_Vel",
      "PROCESSED.Max_RTA_CGPos_VLab_Linear_Vel_MEAN",
    ],
  },
  {
    category: "PROCESSED",
    name: "Bat_travelled_distance_max",
    valueUnit: "NUMBER",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.Bat_travelled_distance_max"],
  },
  {
    category: "PLANE",
    name: "Bat_Angle_Frontal@Contact",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PLANE.Bat_Angle_Frontal@Contact"],
  },
  {
    category: "PLANE",
    name: "Bat_Angle_Sagittal@Contact",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PLANE.Bat_Angle_Sagittal@Contact"],
  },
  {
    category: "PLANE",
    name: "Bat_Angle_Transversal@Contact",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PLANE.Bat_Angle_Transversal@Contact"],
  },
  {
    category: "PROCESSED",
    name: "Lead_Knee_Extension",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    computeFromMap(map) {
      const contact = getFirstValue(map, [
        "PROCESSED.Lead_Knee_Angle@Contact",
        "PROCESSED.Lead_Knee_Angle@Contact_MEAN",
      ]);
      const leadFootDown = getFirstValue(map, [
        "PROCESSED.Lead_Knee_Angle@Lead_Foot_Down",
        "PROCESSED.Lead_Knee_Angle@Lead_Foot_Down_MEAN",
      ]);
      if (contact == null || leadFootDown == null) return null;
      return contact - leadFootDown;
    },
  },
  {
    category: "PROCESSED",
    name: "Lead_Knee_Angle@Lead_Foot_Down",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Lead_Knee_Angle@Lead_Foot_Down",
      "PROCESSED.Lead_Knee_Angle@Lead_Foot_Down_MEAN",
    ],
  },
  {
    category: "PROCESSED",
    name: "Lead_Knee_Angle@Contact",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Lead_Knee_Angle@Contact",
      "PROCESSED.Lead_Knee_Angle@Contact_MEAN",
    ],
  },
  {
    category: "PROCESSED",
    name: "Pelvis_Angle@Lead_Foot_Down",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Pelvis_Angle@Lead_Foot_Down",
      "PROCESSED.Pelvis_Angle@Lead_Foot_Down_MEAN",
    ],
  },
  {
    category: "PROCESSED",
    name: "Pelvis_Angle@Contact",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.Pelvis_Angle@Contact"],
  },
  {
    category: "PROCESSED",
    name: "Pelvis_Total_Rotation",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    computeFromMap(map) {
      const contact = getFirstValue(map, ["PROCESSED.Pelvis_Angle@Contact"]);
      const leadFootDown = getFirstValue(map, [
        "PROCESSED.Pelvis_Angle@Lead_Foot_Down",
        "PROCESSED.Pelvis_Angle@Lead_Foot_Down_MEAN",
      ]);
      if (contact == null || leadFootDown == null) return null;
      return contact - leadFootDown;
    },
  },
  {
    category: "PROCESSED",
    name: "Pelvis_Shoulders_Separation@Setup",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.Pelvis_Shoulders_Separation@Setup"],
  },
  {
    category: "PROCESSED",
    name: "Pelvis_Shoulders_Separation@Lead_Foot_Down",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Pelvis_Shoulders_Separation@Lead_Foot_Down",
      "PROCESSED.Pelvis_Shoulders_Separation@Lead_Foot_Down_MEAN",
    ],
  },
  {
    category: "PROCESSED",
    name: "Pelvis_Shoulders_Separation@Downswing",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Pelvis_Shoulders_Separation@Downswing",
      "PROCESSED.Pelvis_Shoulders_Separation@Downswing_MEAN",
    ],
  },
  {
    category: "PROCESSED",
    name: "Pelvis_Shoulders_Separation@Max_Bat_Ang_Vel",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Pelvis_Shoulders_Separation@Max_Bat_Ang_Vel",
      "PROCESSED.Pelvis_Shoulders_Separation@Max_Bat_Ang_Vel_MEAN",
    ],
  },
  {
    category: "PROCESSED",
    name: "Pelvis_Shoulders_Separation@Max_Lead_Hand_Ang_Vel",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Pelvis_Shoulders_Separation@Max_Lead_Hand_Ang_Vel",
      "PROCESSED.Pelvis_Shoulders_Separation@Max_Lead_Hand_Ang_Vel_MEAN",
    ],
  },
  {
    category: "PROCESSED",
    name: "Pelvis_Shoulders_Separation@Contact",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Pelvis_Shoulders_Separation@Contact",
      "PROCESSED.Pelvis_Shoulders_Separation@Contact_MEAN",
    ],
  },
  {
    category: "PROCESSED",
    name: "Trunk_Angle@Lead_Foot_Down",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Trunk_Angle@Lead_Foot_Down",
      "PROCESSED.Trunk_Angle@Lead_Foot_Down_MEAN",
    ],
  },
  {
    category: "PROCESSED",
    name: "Trunk_Angle@Contact",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.Trunk_Angle@Contact"],
  },
  {
    category: "PROCESSED",
    name: "Trunk_Total_Rotation",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    computeFromMap(map) {
      const contact = getFirstValue(map, [
        "PROCESSED.Trunk_Angle@Contact",
      ]);
      const leadFootDown = getFirstValue(map, [
        "PROCESSED.Trunk_Angle@Lead_Foot_Down",
        "PROCESSED.Trunk_Angle@Lead_Foot_Down_MEAN",
      ]);
      if (contact == null || leadFootDown == null) return null;
      return contact - leadFootDown;
    },
  },
  {
    category: "PROCESSED",
    name: "Stride_Width@Lead_Foot_Down",
    valueUnit: "NUMBER",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Stride_Width@Lead_Foot_Down",
      "PROCESSED.Stride_Width@Lead_Foot_Down_MEAN",
    ],
  },
  {
    category: "PROCESSED",
    name: "Lead_Knee_Ang_Vel_ext_max",
    valueUnit: "DEGREES_PER_SECOND",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Lead_Knee_Ang_Vel_ext_max",
      "PROCESSED.Lead_Knee_Ang_Vel_ext_max_MEAN",
    ],
  },
];

const HITTING_METRIC_NAMES = Array.from(
  new Set(
    HITTING_METRIC_SPECS.flatMap((spec) => spec.metricNameCandidates ?? [])
  )
);

export async function buildHittingPayload(
  athleteUuid: string,
  sessionDate?: string
): Promise<HittingPayload> {
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
    const mostRecentSession = await prisma.f_kinematics_hitting.findFirst({
      where: { athlete_uuid: athleteUuid },
      orderBy: { session_date: "desc" },
      select: { session_date: true },
    });
    if (!mostRecentSession) {
      throw notFound("No hitting data found for athlete");
    }
    resolvedSessionDate = mostRecentSession.session_date;
  }

  const rows = await prisma.f_kinematics_hitting.findMany({
    where: {
      athlete_uuid: athleteUuid,
      session_date: resolvedSessionDate,
      metric_name: { in: [...HITTING_METRIC_NAMES] },
    },
    select: { metric_name: true, value: true },
  });

  const valueByMetricName = new Map<string, number | null>();
  for (const row of rows) {
    if (!valueByMetricName.has(row.metric_name)) {
      valueByMetricName.set(row.metric_name, decimalToNumber(row.value));
    }
  }

  const metrics: HittingPayloadMetric[] = HITTING_METRIC_SPECS.map((spec) => {
    const value =
      spec.computeFromMap?.(valueByMetricName) ??
      (spec.metricNameCandidates
        ? getFirstValue(valueByMetricName, spec.metricNameCandidates)
        : null);
    return {
      category: spec.category,
      name: spec.name,
      value,
      valueUnit: spec.valueUnit,
      orientation: spec.orientation,
    };
  });

  const sessionDateStr = resolvedSessionDate.toISOString().split("T")[0];
  return {
    athleteUuid: athlete.athlete_uuid,
    level: deriveLevelFromAthlete({ age_group: athlete.age_group ?? null }),
    score: null,
    metrics,
    sessionDate: sessionDateStr,
  };
}
