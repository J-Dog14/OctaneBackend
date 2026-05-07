import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/responses";

type Orientation = "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";
type ValueUnit =
  | "NUMBER"
  | "MPH"
  | "DEGREES"
  | "DEGREES_PER_SECOND"
  | "N_BW"
  | "LBS";

export type PitchingPayloadMetric = {
  category: string;
  name: string;
  value: number | null;
  valueUnit: ValueUnit | string;
  orientation: Orientation | string | null;
};

export type PitchingPayload = {
  athleteUuid: string;
  level: string;
  score: number | null;
  metrics: PitchingPayloadMetric[];
  /** ISO date (YYYY-MM-DD) of session used. */
  sessionDate?: string | null;
};

type MetricSpec = {
  category: string;
  name: string;
  valueUnit: ValueUnit;
  orientation: Orientation | null;
  /** Metric names (e.g. in `f_kinematics_pitching.metric_name` or `f_pitching_trials.metrics` keys) to try in order. */
  metricNameCandidates?: string[];
  /** If set, compute value from athlete record instead of kinematics table. */
  fromAthlete?: "weightLbs";
  /** If set, compute value from other computed values. */
  compute?: (ctx: { velocityMph: number | null; weightLbs: number | null }) => number | null;
  /** If set, compute value from the metric value map (e.g. difference of two keys). */
  computeFromMap?: (map: Map<string, number | null>) => number | null;
};

/** Parsed metrics from f_pitching_trials.metrics JSON (metric name -> value). */
export type TrialMetricsMap = Map<string, number | null>;

/** Get value from map, trying key and optional .X/.Y/.Z variant. */
function getFromMap(map: Map<string, number | null>, key: string): number | null {
  const v = map.get(key);
  if (v !== undefined) return v;
  if (key.endsWith("_X")) return map.get(key.slice(0, -2) + ".X") ?? null;
  if (key.endsWith("_Y")) return map.get(key.slice(0, -2) + ".Y") ?? null;
  if (key.endsWith("_Z")) return map.get(key.slice(0, -2) + ".Z") ?? null;
  return null;
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

type ProgressionSummary = {
  gainOrLoss: number | null;
  amountToPeak: number | null;
  peakAfterFootstrikeMs: number | null;
  postPeakLossRate: number | null;
};

function computeProgressionSummary(
  map: Map<string, number | null>,
  opts: {
    footstrikeKey: string;
    incrementPrefix: string;
    axis: "X" | "Y" | "Z";
    lowerIsGain: boolean;
  }
): ProgressionSummary {
  const footstrike = getFromMap(map, `${opts.footstrikeKey}_${opts.axis}`);
  if (footstrike == null) {
    return {
      gainOrLoss: null,
      amountToPeak: null,
      peakAfterFootstrikeMs: null,
      postPeakLossRate: null,
    };
  }

  const points: Array<{ ms: number; value: number }> = [{ ms: 0, value: footstrike }];
  for (let ms = 10; ms <= 110; ms += 10) {
    const value = getFromMap(map, `${opts.incrementPrefix}_${ms}ms_${opts.axis}`);
    if (value != null) points.push({ ms, value });
  }

  let peakPoint = points[0]!;
  for (const p of points) {
    if (opts.lowerIsGain ? p.value < peakPoint.value : p.value > peakPoint.value) {
      peakPoint = p;
    }
  }

  const amountToPeak = opts.lowerIsGain
    ? footstrike - peakPoint.value
    : peakPoint.value - footstrike;

  const gainOrLoss =
    amountToPeak > 0 ? 1 : amountToPeak < 0 ? -1 : 0;

  const peakAfterFootstrikeMs = peakPoint.ms > 0 ? peakPoint.ms : null;
  const laterPoints = points.filter((p) => p.ms > peakPoint.ms);

  let postPeakLossRate: number | null = null;
  if (laterPoints.length > 0) {
    const last = laterPoints[laterPoints.length - 1]!;
    const loss = opts.lowerIsGain
      ? last.value - peakPoint.value
      : peakPoint.value - last.value;
    const dt = last.ms - peakPoint.ms;
    postPeakLossRate = dt > 0 ? loss / dt : null;
  }

  return {
    gainOrLoss,
    amountToPeak,
    peakAfterFootstrikeMs,
    postPeakLossRate,
  };
}

// This is the legacy payload shape you shared in output_payload.json.
// We pull values from `f_pitching_trials.metrics` (JSON) or fallback to `f_kinematics_pitching`.
const PITCHING_METRIC_SPECS: MetricSpec[] = [
  {
    category: "SUBJECT_METRICS",
    name: "SCORE",
    valueUnit: "NUMBER",
    orientation: "HIGHER_IS_BETTER",
    // Placeholder scoring: if we don't have a native score metric in the DB,
    // scale velocity into a similar range.
    compute: ({ velocityMph }) =>
      typeof velocityMph === "number" ? velocityMph * 3.125 : null,
  },
  {
    category: "TRACKMAN_METRICS",
    name: "VELOCITY",
    valueUnit: "MPH",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["BALLSPEED.BALL_RELEASE_SPEED"],
  },
  {
    category: "PELVIS_ROTATION",
    name: "FOOT_PLANT",
    valueUnit: "DEGREES",
    orientation: "LOWER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.Pelvis_Angle@Footstrike.Z", "PROCESSED.Pelvis_Angle@Footstrike_Z"],
  },
  {
    category: "TRUNK_POSITION",
    name: "FOOT_PLANT",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.Trunk_Angle@Footstrike.Z", "PROCESSED.Trunk_Angle@Footstrike_Z"],
  },
  {
    category: "HIP_SHOULDER_SEPARATION",
    name: "FOOT_PLANT",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.Hip Shoulders Sep@Footstrike.Z", "PROCESSED.Hip Shoulders Sep@Footstrike_Z"],
  },
  {
    category: "FRONT_LEG",
    name: "FOOT_PLANT",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.Lead_Knee_Angle@Footstrike.X", "PROCESSED.Lead_Knee_Angle@Footstrike_X"],
  },
  {
    category: "FRONT_LEG",
    name: "RELEASE",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.Lead_Knee_Angle@Release.X", "PROCESSED.Lead_Knee_Angle@Release_X"],
  },
  {
    category: "SHOULDER_ER",
    name: "FOOT_PLANT",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.Pitching_Shoulder_Angle@Footstrike_Z", "PROCESSED.Pitching_Shoulder_Angle@Footstrike.Z"],
  },
  {
    category: "SHOULDER_ER",
    name: "MAX",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.Pitching_Shoulder_Angle_Max_Z", "PROCESSED.Pitching_Shoulder_Angle_Max.Z"],
  },
  {
    category: "ABDUCTION",
    name: "FOOT_PLANT",
    valueUnit: "DEGREES",
    orientation: "LOWER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.Pitching_Shoulder_Angle@Footstrike.X", "PROCESSED.Pitching_Shoulder_Angle@Footstrike_X"],
  },
  {
    category: "ABDUCTION",
    name: "MAX",
    valueUnit: "DEGREES",
    orientation: "LOWER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.Pitching_Shoulder_Angle_Min"],
  },
  {
    category: "KINEMATIC_SEQUENCE",
    name: "PELVIS",
    valueUnit: "DEGREES_PER_SECOND",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["KINEMATIC_SEQUENCE.Pelvis_Ang_Vel_max.X", "KINEMATIC_SEQUENCE.Pelvis_Ang_Vel_max"],
  },
  {
    category: "KINEMATIC_SEQUENCE",
    name: "TORSO",
    valueUnit: "DEGREES_PER_SECOND",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["KINEMATIC_SEQUENCE.Thorax_Ang_Vel_max.X", "KINEMATIC_SEQUENCE.Thorax_Ang_Vel_max"],
  },
  {
    category: "KINEMATIC_SEQUENCE",
    name: "ARM",
    valueUnit: "DEGREES_PER_SECOND",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["KINEMATIC_SEQUENCE.Pitching_Humerus_Ang_Vel_max.X", "KINEMATIC_SEQUENCE.Pitching_Humerus_Ang_Vel_max"],
  },
  {
    category: "KINEMATIC_SEQUENCE",
    name: "HAND",
    valueUnit: "DEGREES_PER_SECOND",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["KINEMATIC_SEQUENCE.Pitching_Hand_Ang_Vel_max.X", "KINEMATIC_SEQUENCE.Pitching_Hand_Ang_Vel_max"],
  },
  {
    category: "KINEMATIC_SEQUENCE",
    name: "PELVIS_TIME",
    valueUnit: "NUMBER",
    orientation: null,
    metricNameCandidates: ["TIMING.MaxPelvisVelTime.X"],
  },
  {
    category: "KINEMATIC_SEQUENCE",
    name: "TORSO_TIME",
    valueUnit: "NUMBER",
    orientation: null,
    metricNameCandidates: ["TIMING.MaxThoraxVelTime.X"],
  },
  {
    category: "KINEMATIC_SEQUENCE",
    name: "ARM_TIME",
    valueUnit: "NUMBER",
    orientation: null,
    metricNameCandidates: ["TIMING.MaxHumerusVelTime.X"],
  },
  {
    category: "KINEMATIC_SEQUENCE",
    name: "HAND_TIME",
    valueUnit: "NUMBER",
    orientation: null,
    metricNameCandidates: ["TIMING.MaxHandVelTime.X"],
  },
  {
    category: "FRONT_LEG",
    name: "EXTENSION",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    computeFromMap(map) {
      const release = getFromMap(map, "PROCESSED.Lead_Knee_Angle@Release_X");
      const footstrike = getFromMap(map, "PROCESSED.Lead_Knee_Angle@Footstrike_X");
      if (release == null || footstrike == null) return null;
      return footstrike - release;
    },
  },
  {
    category: "GRF",
    name: "MID_POINT",
    valueUnit: "N_BW",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.Lead_Leg_GRF_mag_Midpoint_FS_Release.X", "PROCESSED.Lead_Leg_GRF_mag_Midpoint_FS_Release_X"],
  },
  {
    category: "GRF",
    name: "GRF_MAG_MAX",
    valueUnit: "N_BW",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.Lead_Leg_GRF_mag_max.X", "PROCESSED.Lead_Leg_GRF_mag_max_X"],
  },
  {
    category: "GRF",
    name: "Y_DIR",
    valueUnit: "N_BW",
    orientation: "HIGHER_IS_BETTER",
    computeFromMap(map) {
      const y = getFromMap(map, "PROCESSED.Lead_Leg_GRF_min_Y");
      return y == null ? null : Math.abs(y);
    },
  },
  {
    category: "GRF",
    name: "Z_DIR",
    valueUnit: "N_BW",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.Lead_Leg_GRF_max.Z", "PROCESSED.Lead_Leg_GRF_max_Z"],
  },
  {
    category: "LATERAL_TILT",
    name: "RELEASE",
    valueUnit: "DEGREES",
    orientation: "LOWER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.Trunk_Angle@Release.X", "PROCESSED.Trunk_Angle@Release_X"],
  },
  {
    category: "LINEAR_VELOCITY",
    name: "MAX",
    valueUnit: "MPH",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: ["PROCESSED.MaxPelvisLinearVel_MPH"],
  },
  {
    category: "SHOULDER_EXTERNAL_ROTATION",
    name: "MAX",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    metricNameCandidates: [
      "PROCESSED.Pitching_Shoulder_Angle_XYZ@Max_Shoulder_Rot.Z",
      "PROCESSED.Pitching_Shoulder_Angle_XYZ@Max_Shoulder_Rot_Z",
    ],
  },
  {
    category: "PELVIC_OBLIQUITY",
    name: "TOTAL",
    valueUnit: "DEGREES",
    orientation: "LOWER_IS_BETTER",
    computeFromMap(map) {
      const release = getFromMap(map, "PROCESSED.Pelvis_Angle@Release_Y");
      const footstrike = getFromMap(map, "PROCESSED.Pelvis_Angle@Footstrike_Y");
      if (release == null || footstrike == null) return null;
      return release - footstrike;
    },
  },
  {
    category: "TOTAL_TRUNK_FLEXION",
    name: "TOTAL",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    computeFromMap(map) {
      const release = getFromMap(map, "PROCESSED.Trunk_Angle@Release_X");
      const footstrike = getFromMap(map, "PROCESSED.Trunk_Angle@Footstrike_X");
      if (release == null || footstrike == null) return null;
      return release - footstrike;
    },
  },
  {
    category: "ABDUCTION_PROGRESS",
    name: "GAIN_OR_LOSS",
    valueUnit: "NUMBER",
    orientation: "HIGHER_IS_BETTER",
    computeFromMap(map) {
      return computeProgressionSummary(map, {
        footstrikeKey: "PROCESSED.Pitching_Shoulder_Angle@Footstrike",
        incrementPrefix: "INCREMENT.Pitching_Shoulder_Angle@Footstrike",
        axis: "X",
        lowerIsGain: true,
      }).gainOrLoss;
    },
  },
  {
    category: "ABDUCTION_PROGRESS",
    name: "AMOUNT_TO_PEAK",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    computeFromMap(map) {
      return computeProgressionSummary(map, {
        footstrikeKey: "PROCESSED.Pitching_Shoulder_Angle@Footstrike",
        incrementPrefix: "INCREMENT.Pitching_Shoulder_Angle@Footstrike",
        axis: "X",
        lowerIsGain: true,
      }).amountToPeak;
    },
  },
  {
    category: "ABDUCTION_PROGRESS",
    name: "PEAK_AFTER_FOOTSTRIKE_MS",
    valueUnit: "NUMBER",
    orientation: "LOWER_IS_BETTER",
    computeFromMap(map) {
      return computeProgressionSummary(map, {
        footstrikeKey: "PROCESSED.Pitching_Shoulder_Angle@Footstrike",
        incrementPrefix: "INCREMENT.Pitching_Shoulder_Angle@Footstrike",
        axis: "X",
        lowerIsGain: true,
      }).peakAfterFootstrikeMs;
    },
  },
  {
    category: "ABDUCTION_PROGRESS",
    name: "POST_PEAK_LOSS_RATE",
    valueUnit: "NUMBER",
    orientation: "LOWER_IS_BETTER",
    computeFromMap(map) {
      return computeProgressionSummary(map, {
        footstrikeKey: "PROCESSED.Pitching_Shoulder_Angle@Footstrike",
        incrementPrefix: "INCREMENT.Pitching_Shoulder_Angle@Footstrike",
        axis: "X",
        lowerIsGain: true,
      }).postPeakLossRate;
    },
  },
  {
    category: "ABDUCTION",
    name: "TIME_TO_MAX_HOR_ANGLE_MS",
    valueUnit: "NUMBER",
    orientation: "LOWER_IS_BETTER",
    computeFromMap(map) {
      const maxTime = getFromMap(map, "TIMING.MaxShoulderHorAngleTime_X");
      const footstrikeTime = getFromMap(map, "TIMING.FootstrikeTime_X");
      if (maxTime == null || footstrikeTime == null) return null;
      return roundTo((maxTime - footstrikeTime) * 1000, 2);
    },
  },
  {
    category: "HIP_SHOULDER_PROGRESS",
    name: "GAIN_OR_LOSS",
    valueUnit: "NUMBER",
    orientation: "HIGHER_IS_BETTER",
    computeFromMap(map) {
      return computeProgressionSummary(map, {
        footstrikeKey: "PROCESSED.Hip Shoulders Sep@Footstrike",
        incrementPrefix: "INCREMENT.Hip Shoulders Sep@Footstrike",
        axis: "Z",
        lowerIsGain: false,
      }).gainOrLoss;
    },
  },
  {
    category: "HIP_SHOULDER_PROGRESS",
    name: "AMOUNT_TO_PEAK",
    valueUnit: "DEGREES",
    orientation: "HIGHER_IS_BETTER",
    computeFromMap(map) {
      return computeProgressionSummary(map, {
        footstrikeKey: "PROCESSED.Hip Shoulders Sep@Footstrike",
        incrementPrefix: "INCREMENT.Hip Shoulders Sep@Footstrike",
        axis: "Z",
        lowerIsGain: false,
      }).amountToPeak;
    },
  },
  {
    category: "HIP_SHOULDER_PROGRESS",
    name: "PEAK_AFTER_FOOTSTRIKE_MS",
    valueUnit: "NUMBER",
    orientation: "LOWER_IS_BETTER",
    computeFromMap(map) {
      return computeProgressionSummary(map, {
        footstrikeKey: "PROCESSED.Hip Shoulders Sep@Footstrike",
        incrementPrefix: "INCREMENT.Hip Shoulders Sep@Footstrike",
        axis: "Z",
        lowerIsGain: false,
      }).peakAfterFootstrikeMs;
    },
  },
  {
    category: "HIP_SHOULDER_PROGRESS",
    name: "POST_PEAK_LOSS_RATE",
    valueUnit: "NUMBER",
    orientation: "LOWER_IS_BETTER",
    computeFromMap(map) {
      return computeProgressionSummary(map, {
        footstrikeKey: "PROCESSED.Hip Shoulders Sep@Footstrike",
        incrementPrefix: "INCREMENT.Hip Shoulders Sep@Footstrike",
        axis: "Z",
        lowerIsGain: false,
      }).postPeakLossRate;
    },
  },
  {
    category: "SUBJECT_METRICS",
    name: "WEIGHT",
    valueUnit: "LBS",
    orientation: "HIGHER_IS_BETTER",
    fromAthlete: "weightLbs",
  },
];

function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  // Prisma Decimal supports toString()
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  // Decimal.js-like
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyVal = value as any;
  if (typeof anyVal.toNumber === "function") return anyVal.toNumber();
  if (typeof anyVal.toString === "function") {
    const num = Number(anyVal.toString());
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function deriveLevelFromAthlete(athlete: { age_group: string | null }): string {
  const raw = athlete.age_group?.trim();
  if (!raw) return "PRO";
  // Keep as-is if it already matches the enum-ish style used in your payloads.
  const upper = raw.toUpperCase().replace(/\s+/g, "_");
  return upper;
}

/**
 * Parses the `metrics` JSON column from f_pitching_trials into a map of metric name -> number.
 * The trials JSON often uses vector keys with .X / .Y / .Z (e.g. PROCESSED.Pelvis_Angle@Footstrike.X).
 * We store each key as-is and also register the base name for .X keys so lookups like
 * PROCESSED.Pelvis_Angle@Footstrike (used by kinematics) resolve to the .X value.
 */
function parseTrialMetricsJson(metrics: unknown): Map<string, number | null> {
  const out = new Map<string, number | null>();
  if (metrics === null || metrics === undefined || typeof metrics !== "object" || Array.isArray(metrics)) {
    return out;
  }
  const obj = metrics as Record<string, unknown>;
  for (const [key, val] of Object.entries(obj)) {
    // DB may store values as single-element arrays e.g. "key": [-51.08]
    const scalar = Array.isArray(val) && val.length > 0 ? val[0] : val;
    const num = decimalToNumber(scalar);
    out.set(key, num);
    // So payload specs that expect "PROCESSED.Pelvis_Angle@Footstrike" (no suffix) find the value from ".X"
    if (key.endsWith(".X")) {
      const baseKey = key.slice(0, -2);
      if (!out.has(baseKey)) out.set(baseKey, num);
    }
    // Alias _X, _Y, _Z so specs can use either "Key_X" or "Key.X" style
    if (key.endsWith("_X") || key.endsWith("_Y") || key.endsWith("_Z")) {
      const suffix = key.slice(-2);
      const baseKey = key.slice(0, -2);
      const dotKey = `${baseKey}.${suffix === "_X" ? "X" : suffix === "_Y" ? "Y" : "Z"}`;
      if (!out.has(dotKey)) out.set(dotKey, num);
    }
    if (key.includes(".") && (key.endsWith(".Y") || key.endsWith(".Z"))) {
      const baseKey = key.slice(0, -2);
      const underscore = key.endsWith(".Y") ? "_Y" : "_Z";
      const altKey = baseKey + underscore;
      if (!out.has(altKey)) out.set(altKey, num);
    }
  }
  return out;
}

/**
 * Builds the metrics array and payload from a valueByMetricName map (shared by trials and kinematics).
 */
function buildMetricsFromValueMap(
  valueByMetricName: Map<string, number | null>,
  athlete: { athlete_uuid: string; age_group: string | null; weight: unknown }
): PitchingPayload {
  const velocityMph =
    valueByMetricName.get("BALLSPEED.BALL_RELEASE_SPEED") ?? null;
  const weightLbs = decimalToNumber(athlete.weight);

  const metrics: PitchingPayloadMetric[] = PITCHING_METRIC_SPECS.map((spec) => {
    let value: number | null = null;

    if (spec.fromAthlete === "weightLbs") {
      value = weightLbs;
    } else if (spec.computeFromMap) {
      value = spec.computeFromMap(valueByMetricName);
    } else if (spec.compute) {
      value = spec.compute({ velocityMph, weightLbs });
    } else if (spec.metricNameCandidates?.length) {
      for (const candidate of spec.metricNameCandidates) {
        const v = valueByMetricName.get(candidate);
        if (v !== undefined) {
          value = v;
          break;
        }
      }
    }

    return {
      category: spec.category,
      name: spec.name,
      value,
      valueUnit: spec.valueUnit,
      orientation: spec.orientation,
    };
  });

  const scoreMetric = metrics.find(
    (m) => m.category === "SUBJECT_METRICS" && m.name === "SCORE"
  );

  return {
    athleteUuid: athlete.athlete_uuid,
    level: deriveLevelFromAthlete({ age_group: athlete.age_group ?? null }),
    score: scoreMetric?.value ?? null,
    metrics,
  };
}

/** Derive axis component from a resolved metric key (e.g. "_Z" or ".Z" -> "Z"). */
function componentFromKey(key: string): "X" | "Y" | "Z" | null {
  if (key.endsWith("_X") || key.endsWith(".X")) return "X";
  if (key.endsWith("_Y") || key.endsWith(".Y")) return "Y";
  if (key.endsWith("_Z") || key.endsWith(".Z")) return "Z";
  return null;
}

export type PitchingPayloadDebugRow = {
  category: string;
  name: string;
  value: number | null;
  valueUnit: string;
  /** Key that provided the value (candidate key, or "computeFromMap" / "compute" / "fromAthlete"). */
  resolvedKey: string;
  /** Axis component when value came from a vector key (X, Y, Z), or null. */
  component: "X" | "Y" | "Z" | null;
};

/**
 * Builds the pitching payload and returns it plus a debug list: for each metric, the resolved key
 * and component (X/Y/Z) so you can verify what is being pulled from the trials JSON.
 */
export function buildPitchingPayloadWithDebug(
  valueByMetricName: Map<string, number | null>,
  athlete: { athlete_uuid: string; age_group: string | null; weight: unknown }
): { payload: PitchingPayload; debug: PitchingPayloadDebugRow[] } {
  const velocityMph =
    valueByMetricName.get("BALLSPEED.BALL_RELEASE_SPEED") ?? null;
  const weightLbs = decimalToNumber(athlete.weight);

  const debug: PitchingPayloadDebugRow[] = [];

  const metrics: PitchingPayloadMetric[] = PITCHING_METRIC_SPECS.map((spec) => {
    let value: number | null = null;
    let resolvedKey = "";

    if (spec.fromAthlete === "weightLbs") {
      value = weightLbs;
      resolvedKey = "fromAthlete";
    } else if (spec.computeFromMap) {
      value = spec.computeFromMap(valueByMetricName);
      resolvedKey = "computeFromMap";
    } else if (spec.compute) {
      value = spec.compute({ velocityMph, weightLbs });
      resolvedKey = "compute";
    } else if (spec.metricNameCandidates?.length) {
      for (const candidate of spec.metricNameCandidates) {
        const v = valueByMetricName.get(candidate);
        if (v !== undefined) {
          value = v;
          resolvedKey = candidate;
          break;
        }
      }
    }

    debug.push({
      category: spec.category,
      name: spec.name,
      value,
      valueUnit: spec.valueUnit,
      resolvedKey,
      component: resolvedKey ? componentFromKey(resolvedKey) : null,
    });

    return {
      category: spec.category,
      name: spec.name,
      value,
      valueUnit: spec.valueUnit,
      orientation: spec.orientation,
    };
  });

  const scoreMetric = metrics.find(
    (m) => m.category === "SUBJECT_METRICS" && m.name === "SCORE"
  );

  const payload: PitchingPayload = {
    athleteUuid: athlete.athlete_uuid,
    level: deriveLevelFromAthlete({ age_group: athlete.age_group ?? null }),
    score: scoreMetric?.value ?? null,
    metrics,
  };

  return { payload, debug };
}

/**
 * Builds the pitching payload from f_pitching_trials (one row per trial, metrics in JSON).
 * Averages all trials from the most recent (or specified) session.
 */
export async function buildPitchingPayloadFromTrials(
  athleteUuid: string,
  sessionDate?: string
): Promise<PitchingPayload> {
  const athlete = await prisma.d_athletes.findUnique({
    where: { athlete_uuid: athleteUuid },
    select: { athlete_uuid: true, age_group: true, weight: true },
  });

  if (!athlete) {
    throw notFound("Athlete not found");
  }

  // Resolve session date: use provided date or find the most recent.
  let resolvedDate: Date;
  if (sessionDate) {
    resolvedDate = new Date(sessionDate);
  } else {
    const recent = await prisma.f_pitching_trials.findFirst({
      where: { athlete_uuid: athleteUuid },
      orderBy: { session_date: "desc" },
      select: { session_date: true },
    });
    if (!recent) throw notFound("No pitching trial data found for athlete");
    resolvedDate = recent.session_date;
  }

  // Get all trials from that session and average their metrics.
  const allTrials = await prisma.f_pitching_trials.findMany({
    where: { athlete_uuid: athleteUuid, session_date: resolvedDate },
    select: { metrics: true, velocity_mph: true, weight: true, session_date: true },
  });

  if (allTrials.length === 0) {
    throw notFound("No pitching trial data found for athlete");
  }

  const allMaps = allTrials.map((t) => parseTrialMetricsJson(t.metrics));
  const allKeys = new Set<string>();
  for (const m of allMaps) for (const k of m.keys()) allKeys.add(k);

  const avgValueMap = new Map<string, number | null>();
  for (const key of allKeys) {
    const vals = allMaps
      .map((m) => m.get(key))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    avgValueMap.set(key, vals.length > 0 ? vals.reduce((a, b) => a + b) / vals.length : null);
  }

  // Average velocity_mph across all trials and override the ball speed metric.
  const velocities = allTrials
    .map((t) => decimalToNumber(t.velocity_mph))
    .filter((v): v is number => v !== null);
  const avgVelocity = velocities.length > 0 ? velocities.reduce((a, b) => a + b) / velocities.length : null;
  if (avgVelocity !== null) {
    avgValueMap.set("BALLSPEED.BALL_RELEASE_SPEED", avgVelocity);
  }

  const firstTrialWeight = allTrials[0].weight;
  const athleteForBuild =
    firstTrialWeight != null && decimalToNumber(firstTrialWeight) !== null
      ? { ...athlete, weight: firstTrialWeight }
      : athlete;

  const payload = buildMetricsFromValueMap(avgValueMap, athleteForBuild);
  const sessionDateStr = resolvedDate.toISOString().split("T")[0];
  return { ...payload, sessionDate: sessionDateStr };
}

/**
 * Returns the averaged value map and athlete for the most recent pitching session.
 * Used by the payload debug endpoint so we can show resolved key and component per metric.
 */
export async function getPitchingTrialValueMapAndAthlete(athleteUuid: string): Promise<{
  valueByMetricName: Map<string, number | null>;
  athlete: { athlete_uuid: string; age_group: string | null; weight: unknown };
  sessionDate: string;
} | null> {
  const athlete = await prisma.d_athletes.findUnique({
    where: { athlete_uuid: athleteUuid },
    select: { athlete_uuid: true, age_group: true, weight: true },
  });
  if (!athlete) return null;

  const recentSession = await prisma.f_pitching_trials.findFirst({
    where: { athlete_uuid: athleteUuid },
    orderBy: { session_date: "desc" },
    select: { session_date: true },
  });
  if (!recentSession) return null;

  const allTrials = await prisma.f_pitching_trials.findMany({
    where: { athlete_uuid: athleteUuid, session_date: recentSession.session_date },
    select: { metrics: true, velocity_mph: true, weight: true, session_date: true },
  });
  if (allTrials.length === 0) return null;

  const allMaps = allTrials.map((t) => parseTrialMetricsJson(t.metrics));
  const allKeys = new Set<string>();
  for (const m of allMaps) for (const k of m.keys()) allKeys.add(k);

  const avgValueMap = new Map<string, number | null>();
  for (const key of allKeys) {
    const vals = allMaps
      .map((m) => m.get(key))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    avgValueMap.set(key, vals.length > 0 ? vals.reduce((a, b) => a + b) / vals.length : null);
  }

  const velocities = allTrials
    .map((t) => decimalToNumber(t.velocity_mph))
    .filter((v): v is number => v !== null);
  const avgVelocity = velocities.length > 0 ? velocities.reduce((a, b) => a + b) / velocities.length : null;
  if (avgVelocity !== null) {
    avgValueMap.set("BALLSPEED.BALL_RELEASE_SPEED", avgVelocity);
  }

  const firstTrialWeight = allTrials[0].weight;
  const athleteForBuild =
    firstTrialWeight != null && decimalToNumber(firstTrialWeight) !== null
      ? { ...athlete, weight: firstTrialWeight }
      : athlete;

  const sessionDate = recentSession.session_date.toISOString().split("T")[0];
  return { valueByMetricName: avgValueMap, athlete: athleteForBuild, sessionDate };
}

/**
 * Builds the pitching payload from f_kinematics_pitching (one row per metric per frame).
 * Used for comparison and as fallback when no trials data exists.
 */
export async function buildPitchingPayloadFromKinematics(
  athleteUuid: string,
  sessionDate?: string
): Promise<PitchingPayload> {
  const athlete = await prisma.d_athletes.findUnique({
    where: { athlete_uuid: athleteUuid },
    select: { athlete_uuid: true, age_group: true, weight: true },
  });

  if (!athlete) {
    throw notFound("Athlete not found");
  }

  let resolvedSessionDate: Date;
  if (sessionDate) {
    resolvedSessionDate = new Date(sessionDate);
  } else {
    const bestByVelocity = await prisma.f_kinematics_pitching.findFirst({
      where: { athlete_uuid: athleteUuid, metric_name: "BALLSPEED.BALL_RELEASE_SPEED" },
      orderBy: [{ value: "desc" }, { session_date: "desc" }],
      select: { session_date: true, value: true },
    });

    const bestSessionDate =
      bestByVelocity?.session_date ??
      (
        await prisma.f_kinematics_pitching.findFirst({
          where: { athlete_uuid: athleteUuid },
          orderBy: { session_date: "desc" },
          select: { session_date: true },
        })
      )?.session_date;

    if (!bestSessionDate) {
      throw notFound("No pitching data found for athlete");
    }
    resolvedSessionDate = bestSessionDate;
  }

  const candidateMetricNames = Array.from(
    new Set(
      PITCHING_METRIC_SPECS.flatMap((s) => s.metricNameCandidates ?? []).filter(
        Boolean
      )
    )
  );

  const rows = await prisma.f_kinematics_pitching.findMany({
    where: {
      athlete_uuid: athleteUuid,
      session_date: resolvedSessionDate,
      ...(candidateMetricNames.length > 0
        ? { metric_name: { in: candidateMetricNames } }
        : {}),
    },
    select: { metric_name: true, value: true },
  });

  const valueByMetricName = new Map<string, number | null>();
  for (const r of rows) {
    if (!valueByMetricName.has(r.metric_name)) {
      valueByMetricName.set(r.metric_name, decimalToNumber(r.value));
    }
  }

  const payload = buildMetricsFromValueMap(valueByMetricName, athlete);
  const sessionDateStr = resolvedSessionDate.toISOString().split("T")[0];
  return { ...payload, sessionDate: sessionDateStr };
}

/**
 * Builds the pitching payload for a single athlete.
 * Uses f_pitching_trials (metrics JSON) when available; falls back to f_kinematics_pitching otherwise.
 */
export async function buildPitchingPayload(
  athleteUuid: string,
  sessionDate?: string
): Promise<PitchingPayload> {
  const athlete = await prisma.d_athletes.findUnique({
    where: { athlete_uuid: athleteUuid },
    select: { athlete_uuid: true, age_group: true, weight: true },
  });

  if (!athlete) {
    throw notFound("Athlete not found");
  }

  const hasTrials = await prisma.f_pitching_trials.findFirst({
    where: {
      athlete_uuid: athleteUuid,
      ...(sessionDate ? { session_date: new Date(sessionDate) } : {}),
    },
    select: { id: true },
  });

  if (hasTrials) {
    return buildPitchingPayloadFromTrials(athleteUuid, sessionDate);
  }

  return buildPitchingPayloadFromKinematics(athleteUuid, sessionDate);
}

/** Result of comparing payloads from trials vs kinematics for the same athlete. */
export type PitchingPayloadComparison = {
  athleteUuid: string;
  fromTrials: PitchingPayload | null;
  fromKinematics: PitchingPayload | null;
  trialsError?: string;
  kinematicsError?: string;
  /** For each metric (category + name), values from both sources and whether they match. */
  metricDiffs: Array<{
    category: string;
    name: string;
    valueUnit: string;
    valueTrials: number | null;
    valueKinematics: number | null;
    match: boolean;
  }>;
};

/**
 * Builds payloads from both f_pitching_trials and f_kinematics_pitching for the same athlete
 * and returns a side-by-side comparison so you can verify the same numbers are pulled.
 */
export async function comparePitchingPayloads(
  athleteUuid: string
): Promise<PitchingPayloadComparison> {
  const metricDiffs: PitchingPayloadComparison["metricDiffs"] = [];
  let fromTrials: PitchingPayload | null = null;
  let fromKinematics: PitchingPayload | null = null;
  let trialsError: string | undefined;
  let kinematicsError: string | undefined;

  try {
    fromTrials = await buildPitchingPayloadFromTrials(athleteUuid);
  } catch (e) {
    trialsError = e instanceof Error ? e.message : String(e);
  }

  try {
    fromKinematics = await buildPitchingPayloadFromKinematics(athleteUuid);
  } catch (e) {
    kinematicsError = e instanceof Error ? e.message : String(e);
  }

  if (fromTrials?.metrics && fromKinematics?.metrics) {
    const len = Math.max(fromTrials.metrics.length, fromKinematics.metrics.length);
    for (let i = 0; i < len; i++) {
      const t = fromTrials.metrics[i];
      const k = fromKinematics.metrics[i];
      if (!t || !k) continue;
      const valueTrials = t.value;
      const valueKinematics = k.value;
      const match =
        valueTrials === valueKinematics ||
        (valueTrials != null &&
          valueKinematics != null &&
          Number.isFinite(valueTrials) &&
          Number.isFinite(valueKinematics) &&
          Math.abs(valueTrials - valueKinematics) < 1e-9);
      metricDiffs.push({
        category: t.category,
        name: t.name,
        valueUnit: t.valueUnit,
        valueTrials,
        valueKinematics,
        match,
      });
    }
  }

  return {
    athleteUuid,
    fromTrials,
    fromKinematics,
    trialsError,
    kinematicsError,
    metricDiffs,
  };
}

