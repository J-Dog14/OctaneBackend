/**
 * Loads one pitching capture from the warehouse and builds the 8-cylinder
 * report (lib/coach/biomech/framework.ts) with percentiles against every
 * pitcher's latest capture in the database.
 *
 * Pitch categories (2026-11-02): captures can include Breaking Ball / Off Speed /
 * untyped "Pitch" trials. The framework, bands, percentiles and cohort are all
 * fastball-referenced, so fastball is the default and the only graded view.
 * Other categories show the same measurements ungraded, each beside the
 * athlete's fastball value from the same session.
 */

import { definePopulation } from "@/lib/percentiles/populations";
import { prisma } from "@/lib/db/prisma";
import { PITCH_CATEGORIES, PITCH_CATEGORY_LABEL, type PitchCategory } from "./pitchCategory";

export { PITCH_CATEGORIES, PITCH_CATEGORY_LABEL, parsePitchCategory, type PitchCategory } from "./pitchCategory";
import { extractEightCylinders, TrialLookup, withFootContactAliases, type EightCylMetrics, type ForceTrial, type PitchTrial } from "./extract";
import {
  cohortRow,
  cylinderCards,
  cylinderPercentiles,
  detailMetrics,
  writtenRead,
  type CohortRow,
  type CylinderCard,
  type CylinderPercentiles,
  type DetailMetric,
  type WrittenRead,
} from "./framework";

export interface BiomechReport {
  athlete: {
    athleteUuid: string;
    name: string;
    handed: "RHP" | "LHP" | null;
    age: number | null;
    heightIn: number | null;
    weightLb: number | null;
  };
  sessionDate: string;
  sessions: string[];
  /** Category this report shows; only "fastball" is graded. */
  category: PitchCategory;
  /** Trials per category in this session (categories with none are omitted). */
  categories: Array<{ category: PitchCategory; count: number }>;
  /** Mean fastball velo in the same session (shown next to non-fastball captures). */
  fastballVelo: number | null;
  metrics: EightCylMetrics;
  cards: CylinderCard[];
  details: DetailMetric[];
  read: WrittenRead;
  percentiles: CylinderPercentiles | null;
  cohortN: number;
}

/** Variable names (without folder / component) the extractor reads. Keeps the cohort query small. */
const VARIABLES = withFootContactAliases([
  "STRIDE_LENGTH_MEAN_PERCENT", "STRIDE_LENGTH", "Back_Leg_GRF_mag_max", "Back_Knee_Angle@Footstrike", "Back_Knee_Angle@Max_Shoulder_Rot",
  "MaxPelvisLinearVel_MPH", "MaxTrunkLinearVel_MPH", "Trunk Rot wrt Pelvis Rot@Footstrike", "Trunk Rot wrt Pelvis Rot@Max_Shoulder_Rot",
  "Trunk Rot wrt Pelvis Rot@Release", "Pelvis_Ang_Vel_max", "Thorax_Ang_Vel_max", "Pitching_Humerus_Ang_Vel_max", "Pitching_Hand_Ang_Vel_max",
  "FootstrikeTime", "ReleaseTime", "MaxPelvisVelTime", "MaxThoraxVelTime", "MaxHumerusVelTime", "MaxHandVelTime", "PelvisRot_StopTime",
  "Max_Forearm_PronSup_Ang_VelTime", "Lead_Knee_Angle@Footstrike", "Lead_Knee_Angle@Release", "Lead GRF_BW@Release",
  "Pelvis_Angle@Footstrike", "Pelvis_Angle@Max_Shoulder_Rot", "Pelvis_Angle@Release", "Pelvis_Angle@PelvisRot_Stop",
  "Pelvis_Ang_Vel@Footstrike", "Pelvis_Ang_Vel@Max_Shoulder_Rot", "Pelvis_Ang_Vel@Release",
  "Pitching_Shoulder_Angle@Footstrike", "Pitching_Shoulder_Angle@Max_Shoulder_Rot", "Pitching_Shoulder_Angle@Release",
  "Pitching_Shoulder_Angle@Release100msAfter", "Elbow_Torque_Nm@Max_Shoulder_Rot", "Shoulder_Force_Abd@Max_Shoulder_Abd_Force",
  "Trunk_Angle@Footstrike", "Trunk_Angle@Release",
  ...[10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120].map((ms) => `Pitching_Shoulder_Angle@Footstrike_${ms}ms`),
]);

type ForceRow = {
  trial_index: number;
  lead_peak_vertical_bw: number | null;
  lead_peak_braking_bw: number | null;
  lead_peak_vertical_pct_fc_br: number | null;
  lead_peak_braking_pct_fc_br: number | null;
  peaks_synced_flag: boolean | null;
  peaks_before_mer_flag: boolean | null;
  drive_peak_vertical_bw: number | null;
};

const FORCE_VALS = `lead_peak_vertical_bw::float8 AS lead_peak_vertical_bw, lead_peak_braking_bw::float8 AS lead_peak_braking_bw,
  lead_peak_vertical_pct_fc_br::float8 AS lead_peak_vertical_pct_fc_br, lead_peak_braking_pct_fc_br::float8 AS lead_peak_braking_pct_fc_br,
  peaks_synced_flag, peaks_before_mer_flag, drive_peak_vertical_bw::float8 AS drive_peak_vertical_bw`;

function toForce(r: ForceRow): ForceTrial {
  return {
    leadPeakVerticalBw: r.lead_peak_vertical_bw,
    leadPeakBrakingBw: r.lead_peak_braking_bw,
    leadPeakVerticalPctFcBr: r.lead_peak_vertical_pct_fc_br,
    leadPeakBrakingPctFcBr: r.lead_peak_braking_pct_fc_br,
    peaksSynced: r.peaks_synced_flag,
    peaksBeforeMer: r.peaks_before_mer_flag,
    drivePeakVerticalBw: r.drive_peak_vertical_bw,
  };
}

/** The force-plate layer is optional (older warehouses don't have the table). */
async function forceRows(sql: string, ...params: unknown[]): Promise<Array<ForceRow & { athlete_uuid?: string }>> {
  try {
    return await prisma.$queryRawUnsafe<Array<ForceRow & { athlete_uuid?: string }>>(sql, ...params);
  } catch (err) {
    if (/does not exist/.test(String(err))) return [];
    throw err;
  }
}

/** Sessions with any pitching trials (all categories; the report picks the category). */
export async function listPitchingSessions(athleteUuid: string): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ d: string }>>(
    `SELECT DISTINCT session_date::text AS d FROM public.f_pitching_trials WHERE athlete_uuid = $1 ORDER BY d DESC`,
    athleteUuid,
  );
  return rows.map((r) => r.d);
}

/** Every pitcher's latest capture, prepared by the population worker. */
const getCohort = definePopulation(
  "coach-biomech-cohort-v1",
  async (): Promise<Array<{ athleteUuid: string; row: CohortRow }>> => {
    const trials = await prisma.$queryRawUnsafe<Array<{ athlete_uuid: string; trial_index: number; velo: number | null; m: Record<string, unknown> | null }>>(
      `WITH latest AS (
         SELECT athlete_uuid, max(session_date) AS d FROM public.f_pitching_trials
          WHERE pitch_category = 'fastball' GROUP BY athlete_uuid
       )
       SELECT t.athlete_uuid, t.trial_index, t.velocity_mph::float8 AS velo,
              (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(t.metrics::jsonb) e
                WHERE split_part(e.key, '.', 2) = ANY($1::text[])) AS m
         FROM public.f_pitching_trials t
         JOIN latest l ON l.athlete_uuid = t.athlete_uuid AND l.d = t.session_date
        WHERE t.pitch_category = 'fastball'`,
      VARIABLES,
    );
    const force = await forceRows(
      `WITH latest AS (
         SELECT athlete_uuid, max(session_date) AS d FROM public.f_pitching_trials
          WHERE pitch_category = 'fastball' GROUP BY athlete_uuid
       )
       SELECT f.athlete_uuid, f.trial_index, ${FORCE_VALS}
         FROM public.f_pitching_force_metrics f
         JOIN latest l ON l.athlete_uuid = f.athlete_uuid AND l.d = f.session_date
        WHERE f.pitch_category = 'fastball'`,
    );
    const byAthlete = new Map<string, PitchTrial[]>();
    for (const t of trials) {
      const list = byAthlete.get(t.athlete_uuid) ?? [];
      list.push({ trialIndex: t.trial_index, velocityMph: t.velo, lookup: new TrialLookup(t.m ?? {}) });
      byAthlete.set(t.athlete_uuid, list);
    }
    const forceBy = new Map<string, ForceTrial[]>();
    for (const r of force) {
      const list = forceBy.get(r.athlete_uuid!) ?? [];
      list.push(toForce(r));
      forceBy.set(r.athlete_uuid!, list);
    }
    return [...byAthlete.entries()].map(([athleteUuid, list]) => ({
      athleteUuid,
      row: cohortRow(extractEightCylinders(list, forceBy.get(athleteUuid) ?? [])),
    }));
  },
  () => [] as Array<{ athleteUuid: string; row: CohortRow }>,
);

type TrialRow = { trial_index: number; velo: number | null; metrics: Record<string, unknown>; handedness: string | null; age: number | null; height: number | null; weight: number | null };

async function sessionTrials(athleteUuid: string, sessionDate: string, category: PitchCategory) {
  const [trialRows, force] = await Promise.all([
    prisma.$queryRawUnsafe<TrialRow[]>(
      `SELECT trial_index, velocity_mph::float8 AS velo, metrics, handedness, age_at_collection::float8 AS age,
              height::float8 AS height, weight::float8 AS weight
         FROM public.f_pitching_trials
        WHERE athlete_uuid = $1 AND session_date = $2::date AND pitch_category = $3
        ORDER BY trial_index`,
      athleteUuid,
      sessionDate,
      category,
    ),
    forceRows(
      `SELECT trial_index, ${FORCE_VALS} FROM public.f_pitching_force_metrics
        WHERE athlete_uuid = $1 AND session_date = $2::date AND pitch_category = $3 ORDER BY trial_index`,
      athleteUuid,
      sessionDate,
      category,
    ),
  ]);
  const trials: PitchTrial[] = trialRows.map((t) => ({ trialIndex: t.trial_index, velocityMph: t.velo, lookup: new TrialLookup(t.metrics ?? {}) }));
  return { trialRows, metrics: trialRows.length ? extractEightCylinders(trials, force.map(toForce)) : null };
}

/**
 * Non-fastball view: same measurements, no grading. Bands, percentiles and the
 * written read are fastball-referenced, so each value sits beside the fastball
 * value from the same session instead.
 */
function ungraded(
  name: string,
  category: PitchCategory,
  metrics: EightCylMetrics,
  fb: EightCylMetrics | null,
): { cards: CylinderCard[]; details: DetailMetric[]; read: WrittenRead } {
  const fbCards = fb ? cylinderCards(fb, null) : [];
  const fbDetails = fb ? detailMetrics(fb) : [];
  const cards = cylinderCards(metrics, null).map((c) => ({
    ...c,
    status: "neutral" as const,
    percentile: null,
    benchmarkText: `Fastball: ${fbCards.find((f) => f.key === c.key)?.valueText ?? "no fastballs this session"}`,
  }));
  const details = detailMetrics(metrics).map((d) => ({
    ...d,
    status: "neutral" as const,
    refText: `FB ${fbDetails.find((f) => f.group === d.group && f.label === d.label)?.valueText ?? "—"}`,
  }));
  const lbl = PITCH_CATEGORY_LABEL[category];
  const v = metrics.velocity;
  const fv = fb?.velocity.mean ?? null;
  const veloText = v.mean != null ? `averaged ${v.mean.toFixed(1)} mph across ${v.count} ${v.count === 1 ? lbl.one.toLowerCase() : lbl.many}` : `has ${v.count} ${lbl.many} captured`;
  const fbText = fv != null ? ` (fastball ${fv.toFixed(1)} mph, ${(v.mean != null ? v.mean - fv : 0).toFixed(1)} mph difference)` : "";
  return {
    cards,
    details,
    read: {
      summary: `${name} ${veloText}${fbText}. Our framework, bands and percentiles are built on fastball mechanics, so this view is not graded: each value is shown beside his fastball from the same session.`,
      archetype: null,
      whatsWorking: [],
      whereLeaking: [],
      recommendations: [],
      bottomLine: `Use this to see how his delivery changes from the fastball to the ${lbl.one.toLowerCase()}, not as a grade.`,
      flags: [`${lbl.one} captures — not graded, not included in percentiles, cohorts or anything sent to the Octane app.`],
    },
  };
}

/** Null when the athlete has no pitching captures (or not on `date`). */
export async function buildBiomechReport(
  athleteUuid: string,
  date?: string | null,
  requested: PitchCategory = "fastball",
): Promise<BiomechReport | null> {
  const sessions = await listPitchingSessions(athleteUuid);
  if (!sessions.length) return null;
  const sessionDate = date && sessions.includes(date) ? date : sessions[0]!;

  const counts = await prisma.$queryRawUnsafe<Array<{ c: string; n: number }>>(
    `SELECT pitch_category AS c, count(*)::int AS n FROM public.f_pitching_trials
      WHERE athlete_uuid = $1 AND session_date = $2::date GROUP BY pitch_category`,
    athleteUuid,
    sessionDate,
  );
  const categories = PITCH_CATEGORIES.flatMap((c) => {
    const n = counts.find((r) => r.c === c)?.n ?? 0;
    return n > 0 ? [{ category: c, count: n }] : [];
  });
  if (!categories.length) return null;
  // Requested category if this session has it, else fastball, else whatever was captured.
  const category = categories.some((c) => c.category === requested)
    ? requested
    : categories.some((c) => c.category === "fastball")
      ? "fastball"
      : categories[0]!.category;

  const [athlete, selected, fbSession] = await Promise.all([
    prisma.d_athletes.findUnique({
      where: { athlete_uuid: athleteUuid },
      select: { name: true, date_of_birth: true, height: true, weight: true },
    }),
    sessionTrials(athleteUuid, sessionDate, category),
    category === "fastball" ? Promise.resolve(null) : sessionTrials(athleteUuid, sessionDate, "fastball"),
  ]);
  const { trialRows, metrics } = selected;
  if (!athlete || !trialRows.length || !metrics) return null;
  const fbMetrics = category === "fastball" ? metrics : (fbSession?.metrics ?? null);

  const cohort = await getCohort().catch((err) => {
    console.error("coach biomech cohort failed:", err);
    return [] as Array<{ athleteUuid: string; row: CohortRow }>;
  });

  let percentiles: CylinderPercentiles | null = null;
  let cards: CylinderCard[];
  let details: DetailMetric[];
  let read: WrittenRead;
  if (category === "fastball") {
    percentiles = cohort.length >= 3 ? cylinderPercentiles(cohortRow(metrics), cohort.map((c) => c.row)) : null;
    cards = cylinderCards(metrics, percentiles);
    details = detailMetrics(metrics);
    read = writtenRead(athlete.name, metrics, cards, percentiles, cohort.length);
  } else {
    ({ cards, details, read } = ungraded(athlete.name, category, metrics, fbMetrics));
  }

  const hand = (trialRows.find((t) => t.handedness)?.handedness ?? "").toLowerCase();
  const first = trialRows[0]!;
  return {
    athlete: {
      athleteUuid,
      name: athlete.name,
      handed: hand.startsWith("l") ? "LHP" : hand.startsWith("r") ? "RHP" : null,
      age: first.age != null ? Math.round(first.age * 10) / 10 : null,
      heightIn: athlete.height != null ? Number(athlete.height) : first.height,
      weightLb: athlete.weight != null ? Number(athlete.weight) : first.weight,
    },
    sessionDate,
    sessions,
    category,
    categories,
    fastballVelo: fbMetrics?.velocity.mean ?? null,
    metrics,
    cards,
    details,
    read,
    percentiles,
    cohortN: cohort.length,
  };
}
