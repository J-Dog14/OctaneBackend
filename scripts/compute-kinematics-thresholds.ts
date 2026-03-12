/**
 * One-off script: compute Bad/Average/Good (and Very Bad/Elite) threshold percentiles
 * for pitching and hitting kinematics metrics.
 *
 * Run: npx tsx scripts/compute-kinematics-thresholds.ts
 *
 * Output: scripts/output/kinematics-thresholds.json and kinematics-thresholds.csv
 */

import { prisma } from "../lib/db/prisma";
import { decimalToNumber } from "../lib/octane/utils";

const OUTPUT_DIR = "scripts/output";

type Orientation = "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";

type ThresholdMetric = {
  metricKey: string;
  displayName: string;
  domain: "pitching" | "hitting";
  orientation: Orientation;
  percentiles: { p15: number; p33: number; p66: number; p85: number };
  n: number;
};

// ---- Helpers for parsing f_pitching_trials.metrics JSON ----
function parseTrialMetrics(metrics: unknown): Map<string, number | null> {
  const out = new Map<string, number | null>();
  if (metrics == null || typeof metrics !== "object" || Array.isArray(metrics)) return out;
  const obj = metrics as Record<string, unknown>;
  for (const [key, val] of Object.entries(obj)) {
    const scalar = Array.isArray(val) && val.length > 0 ? val[0] : val;
    const num = decimalToNumber(scalar);
    out.set(key, num);
    if (key.endsWith(".X")) {
      const base = key.slice(0, -2);
      if (!out.has(base)) out.set(base, num);
    }
    if (key.endsWith("_X") || key.endsWith("_Y") || key.endsWith("_Z")) {
      const base = key.slice(0, -2);
      const s = key.slice(-2);
      const dot = `${base}.${s === "_X" ? "X" : s === "_Y" ? "Y" : "Z"}`;
      if (!out.has(dot)) out.set(dot, num);
    }
    if (key.includes(".") && (key.endsWith(".Y") || key.endsWith(".Z"))) {
      const base = key.slice(0, -2);
      const alt = base + (key.endsWith(".Y") ? "_Y" : "_Z");
      if (!out.has(alt)) out.set(alt, decimalToNumber(obj[key]));
    }
  }
  return out;
}

function getFromMap(map: Map<string, number | null>, key: string): number | null {
  const v = map.get(key);
  if (v !== undefined) return v;
  if (key.endsWith("_X")) return map.get(key.slice(0, -2) + ".X") ?? null;
  if (key.endsWith("_Y")) return map.get(key.slice(0, -2) + ".Y") ?? null;
  if (key.endsWith("_Z")) return map.get(key.slice(0, -2) + ".Z") ?? null;
  return null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (idx - lo) * (sorted[hi]! - sorted[lo]!);
}

// ---- Pitching: one value per athlete (best trial by velocity) ----
async function getPitchingValuesByAthlete(): Promise<
  Map<string, Map<string, number>>
> {
  const trials = await prisma.f_pitching_trials.findMany({
    orderBy: { velocity_mph: "desc" },
    select: { athlete_uuid: true, metrics: true },
  });
  const bestByAthlete = new Map<string, { metrics: unknown }>();
  for (const t of trials) {
    if (!bestByAthlete.has(t.athlete_uuid) && t.metrics) {
      bestByAthlete.set(t.athlete_uuid, { metrics: t.metrics });
    }
  }

  const athleteToValues = new Map<string, Map<string, number>>();

  for (const [athleteUuid, { metrics }] of bestByAthlete) {
    const map = parseTrialMetrics(metrics);

    const out = new Map<string, number>();

    const keys: Array<{ key: string; name: string; get: () => number | null }> = [
      { key: "Pelvis_Angle@Footstrike.X", name: "Pelvis @ FC X", get: () => getFromMap(map, "PROCESSED.Pelvis_Angle@Footstrike.X") },
      { key: "Pelvis_Angle@Footstrike.Y", name: "Pelvis @ FC Y", get: () => getFromMap(map, "PROCESSED.Pelvis_Angle@Footstrike.Y") },
      { key: "Pelvis_Angle@Footstrike.Z", name: "Pelvis @ FC Z", get: () => getFromMap(map, "PROCESSED.Pelvis_Angle@Footstrike.Z") },
      { key: "Pelvis_Angle@Release.X", name: "Pelvis @ Release X", get: () => getFromMap(map, "PROCESSED.Pelvis_Angle@Release.X") },
      { key: "Pelvis_Angle@Release.Y", name: "Pelvis @ Release Y", get: () => getFromMap(map, "PROCESSED.Pelvis_Angle@Release.Y") },
      { key: "Pelvis_Angle@Release.Z", name: "Pelvis @ Release Z", get: () => getFromMap(map, "PROCESSED.Pelvis_Angle@Release.Z") },
      { key: "Trunk_Angle@Footstrike.X", name: "Trunk @ FC X", get: () => getFromMap(map, "PROCESSED.Trunk_Angle@Footstrike.X") },
      { key: "Trunk_Angle@Footstrike.Y", name: "Trunk @ FC Y", get: () => getFromMap(map, "PROCESSED.Trunk_Angle@Footstrike.Y") },
      { key: "Trunk_Angle@Footstrike.Z", name: "Trunk @ FC Z", get: () => getFromMap(map, "PROCESSED.Trunk_Angle@Footstrike.Z") },
      { key: "Trunk_Angle@Release.X", name: "Trunk @ Release X", get: () => getFromMap(map, "PROCESSED.Trunk_Angle@Release.X") },
      { key: "Trunk_Angle@Release.Y", name: "Trunk @ Release Y", get: () => getFromMap(map, "PROCESSED.Trunk_Angle@Release.Y") },
      { key: "Trunk_Angle@Release.Z", name: "Trunk @ Release Z", get: () => getFromMap(map, "PROCESSED.Trunk_Angle@Release.Z") },
      { key: "HipShouldersSep@Footstrike.X", name: "HSS @ FC X", get: () => getFromMap(map, "PROCESSED.Hip Shoulders Sep@Footstrike.X") },
      { key: "HipShouldersSep@Footstrike.Y", name: "HSS @ FC Y", get: () => getFromMap(map, "PROCESSED.Hip Shoulders Sep@Footstrike.Y") },
      { key: "HipShouldersSep@Footstrike.Z", name: "HSS @ FC Z", get: () => getFromMap(map, "PROCESSED.Hip Shoulders Sep@Footstrike.Z") },
      {
        key: "Trunk_Translation_FC_Release.X",
        name: "Trunk translation FC→Release X",
        get: () => {
          const r = getFromMap(map, "PROCESSED.Trunk_Angle@Release.X");
          const f = getFromMap(map, "PROCESSED.Trunk_Angle@Footstrike.X");
          return r != null && f != null ? r - f : null;
        },
      },
      {
        key: "Trunk_Translation_FC_Release.Y",
        name: "Trunk translation FC→Release Y",
        get: () => {
          const r = getFromMap(map, "PROCESSED.Trunk_Angle@Release.Y");
          const f = getFromMap(map, "PROCESSED.Trunk_Angle@Footstrike.Y");
          return r != null && f != null ? r - f : null;
        },
      },
      {
        key: "Trunk_Translation_FC_Release.Z",
        name: "Trunk translation FC→Release Z",
        get: () => {
          const r = getFromMap(map, "PROCESSED.Trunk_Angle@Release.Z");
          const f = getFromMap(map, "PROCESSED.Trunk_Angle@Footstrike.Z");
          return r != null && f != null ? r - f : null;
        },
      },
      {
        key: "Pelvis_Translation_FC_Release.X",
        name: "Pelvis translation FC→Release X",
        get: () => {
          const r = getFromMap(map, "PROCESSED.Pelvis_Angle@Release.X");
          const f = getFromMap(map, "PROCESSED.Pelvis_Angle@Footstrike.X");
          return r != null && f != null ? r - f : null;
        },
      },
      {
        key: "Pelvis_Translation_FC_Release.Y",
        name: "Pelvis translation FC→Release Y",
        get: () => {
          const r = getFromMap(map, "PROCESSED.Pelvis_Angle@Release.Y");
          const f = getFromMap(map, "PROCESSED.Pelvis_Angle@Footstrike.Y");
          return r != null && f != null ? r - f : null;
        },
      },
      {
        key: "Pelvis_Translation_FC_Release.Z",
        name: "Pelvis translation FC→Release Z",
        get: () => {
          const r = getFromMap(map, "PROCESSED.Pelvis_Angle@Release.Z");
          const f = getFromMap(map, "PROCESSED.Pelvis_Angle@Footstrike.Z");
          return r != null && f != null ? r - f : null;
        },
      },
      {
        key: "Knee_Flexion_X_FC_to_Release",
        name: "Knee flexion (X) diff FC→Release",
        get: () => {
          const f = getFromMap(map, "PROCESSED.Lead_Knee_Angle@Footstrike.X");
          const r = getFromMap(map, "PROCESSED.Lead_Knee_Angle@Release.X");
          return f != null && r != null ? f - r : null;
        },
      },
      { key: "Trunk_Angle@Max_Shoulder_Rot.X", name: "Trunk @ Max Shoulder Rot X", get: () => getFromMap(map, "PROCESSED.Trunk_Angle@Max_Shoulder_Rot.X") },
      { key: "Trunk_Angle@Max_Shoulder_Rot.Y", name: "Trunk @ Max Shoulder Rot Y", get: () => getFromMap(map, "PROCESSED.Trunk_Angle@Max_Shoulder_Rot.Y") },
      { key: "Trunk_Angle@Max_Shoulder_Rot.Z", name: "Trunk @ Max Shoulder Rot Z", get: () => getFromMap(map, "PROCESSED.Trunk_Angle@Max_Shoulder_Rot.Z") },
      {
        key: "Back_Knee_Angle_max.X",
        name: "Back knee angle max X",
        get: () => {
          const direct =
            getFromMap(map, "PROCESSED.Back_Knee_Angle_max.X") ??
            getFromMap(map, "PROCESSED.Back_Knee_Angle_max_X");
          if (direct != null && Number.isFinite(direct)) return direct;
          const backKneeXKeys = [
            "PROCESSED.Back_Knee_Angle@Footstrike.X",
            "PROCESSED.Back_Knee_Angle@MaxKneeHeight.X",
            "PROCESSED.Back_Knee_Angle@Max_Shoulder_Int_Rot_FollowThru.X",
            "PROCESSED.Back_Knee_Angle@Max_Shoulder_Rot.X",
            "PROCESSED.Back_Knee_Angle@PelvisRot_Stop.X",
            "PROCESSED.Back_Knee_Angle@Release.X",
            "PROCESSED.Back_Knee_Angle@Release100msAfter.X",
            "PROCESSED.Back_Knee_Angle@Setup.X",
          ];
          let max: number | null = null;
          for (const k of backKneeXKeys) {
            const v = getFromMap(map, k);
            if (v != null && Number.isFinite(v) && (max === null || v > max)) max = v;
          }
          return max;
        },
      },
    ];

    for (const { key, get } of keys) {
      const v = get();
      if (v != null && Number.isFinite(v)) out.set(key, v);
    }
    if (out.size > 0) athleteToValues.set(athleteUuid, out);
  }
  return athleteToValues;
}

// ---- Hitting trials (f_hitting_trials): Trunk/Pelvis X at Lead_Foot_Down and Contact ----
async function getHittingTrialsMetricsByAthlete(): Promise<{
  byAthlete: Map<string, Map<string, number>>;
  trialAthleteUuids: string[];
  notInDAthletes: string[];
}> {
  const trials = await prisma.f_hitting_trials.findMany({
    orderBy: { session_date: "desc" },
    select: { athlete_uuid: true, session_date: true, metrics: true },
  });
  // Group all trials by athlete so we can find the first one with rotation data
  const allByAthlete = new Map<string, { metrics: unknown }[]>();
  for (const t of trials) {
    if (!t.metrics) continue;
    if (!allByAthlete.has(t.athlete_uuid)) allByAthlete.set(t.athlete_uuid, []);
    allByAthlete.get(t.athlete_uuid)!.push({ metrics: t.metrics });
  }
  const trialAthleteUuids = Array.from(allByAthlete.keys());

  // Verify every f_hitting_trials athlete_uuid exists in d_athletes
  let notInDAthletes: string[] = [];
  if (trialAthleteUuids.length > 0) {
    const inDb = await prisma.d_athletes.findMany({
      where: { athlete_uuid: { in: trialAthleteUuids } },
      select: { athlete_uuid: true },
    });
    const inDbSet = new Set(inDb.map((r) => r.athlete_uuid));
    notInDAthletes = trialAthleteUuids.filter((u) => !inDbSet.has(u));
    if (notInDAthletes.length > 0) {
      console.warn(
        "[f_hitting_trials] Bug: these athlete_uuids are in f_hitting_trials but NOT in d_athletes:",
        notInDAthletes
      );
    }
  }

  // Log first trial's metric keys that look like Trunk/Pelvis/Lead/Foot/Contact (for debugging key names)
  const firstTrial = trials[0];
  if (firstTrial?.metrics && typeof firstTrial.metrics === "object" && !Array.isArray(firstTrial.metrics)) {
    const keys = Object.keys(firstTrial.metrics as Record<string, unknown>);
    const relevant = keys.filter(
      (k) =>
        /Trunk|Pelvis|Lead|Foot|Contact/i.test(k) && (k.includes(".X") || k.includes("_X") || k.includes("Angle"))
    );
    if (relevant.length > 0) {
      console.log("[f_hitting_trials] Sample metric keys (first trial, Trunk/Pelvis/Foot/Contact):", relevant.slice(0, 30));
    } else {
      console.log("[f_hitting_trials] First trial metrics key count:", keys.length, "(no Trunk/Pelvis/Foot/Contact keys found)");
    }
  }

  const athleteToValues = new Map<string, Map<string, number>>();
  // Use .Z (rotation) from f_hitting_trials — bare key also stores Z (last component wins in R/TS loop)
  const trunkLfdCandidates = [
    "PROCESSED.Trunk_Angle@Lead_Foot_Down.Z",
    "PROCESSED.Trunk_Angle@Lead_Foot_Down",
  ];
  const trunkContactCandidates = [
    "PROCESSED.Trunk_Angle@Contact.Z",
    "PROCESSED.Trunk_Angle@Contact",
  ];
  const pelvisLfdCandidates = [
    "PROCESSED.Pelvis_Angle@Lead_Foot_Down.Z",
    "PROCESSED.Pelvis_Angle@Lead_Foot_Down",
  ];

  for (const [athleteUuid, trialList] of allByAthlete) {
    const out = new Map<string, number>();

    // Search all trials for this athlete to find the first with valid rotation data
    const findFirst = (candidates: string[]): number | undefined => {
      for (const { metrics } of trialList) {
        const map = parseTrialMetrics(metrics);
        const v = candidates.map((k) => getFromMap(map, k)).find((v) => v != null && Number.isFinite(v));
        if (v != null) return v;
      }
      return undefined;
    };

    const trunkLfd = findFirst(trunkLfdCandidates);
    const trunkContact = findFirst(trunkContactCandidates);
    const pelvisLfd = findFirst(pelvisLfdCandidates);

    // Override f_kinematics_hitting values with correct Z rotation from f_hitting_trials
    if (trunkLfd != null) out.set("Trunk_Angle@Lead_Foot_Down", trunkLfd);
    if (trunkContact != null) out.set("Trunk_Angle@Contact", trunkContact);
    if (pelvisLfd != null) out.set("Pelvis_Angle@Lead_Foot_Down", pelvisLfd);

    if (out.size > 0) athleteToValues.set(athleteUuid, out);
  }
  return { byAthlete: athleteToValues, trialAthleteUuids, notInDAthletes };
}

const HITTING_METRIC_NAMES = [
  "PROCESSED.Pelvis_Angle@Lead_Foot_Down",
  "PROCESSED.Pelvis_Angle@Lead_Foot_Down_MEAN",
  "PROCESSED.Pelvis_Angle@Contact",
  "PROCESSED.Trunk_Angle@Lead_Foot_Down",
  "PROCESSED.Trunk_Angle@Lead_Foot_Down_MEAN",
  "PROCESSED.Trunk_Angle@Contact",
  "PROCESSED.Pelvis_Shoulders_Separation@Lead_Foot_Down",
  "PROCESSED.Pelvis_Shoulders_Separation@Lead_Foot_Down_MEAN",
  "PROCESSED.Lead_Knee_Angle@Lead_Foot_Down",
  "PROCESSED.Lead_Knee_Angle@Lead_Foot_Down_MEAN",
  "PROCESSED.Lead_Knee_Angle@Contact",
  "PROCESSED.Lead_Knee_Angle@Contact_MEAN",
];

// ---- Hitting: one value per athlete (most recent session) ----
async function getHittingValuesByAthlete(): Promise<
  Map<string, Map<string, number>>
> {
  const rows = await prisma.f_kinematics_hitting.findMany({
    where: { metric_name: { in: HITTING_METRIC_NAMES } },
    select: { athlete_uuid: true, session_date: true, metric_name: true, value: true },
  });

  const byAthleteSession = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const key = `${r.athlete_uuid}\t${r.session_date.toISOString().slice(0, 10)}`;
    if (!byAthleteSession.has(key)) byAthleteSession.set(key, new Map());
    const sessionMap = byAthleteSession.get(key)!;
    if (!sessionMap.has(r.metric_name)) {
      const v = decimalToNumber(r.value);
      if (v != null && Number.isFinite(v)) sessionMap.set(r.metric_name, v);
    }
  }

  const latestSessionByAthlete = new Map<string, string>();
  for (const key of byAthleteSession.keys()) {
    const [athleteUuid, sessionDate] = key.split("\t");
    const existing = latestSessionByAthlete.get(athleteUuid);
    if (!existing || sessionDate > existing) {
      latestSessionByAthlete.set(athleteUuid, sessionDate);
    }
  }

  const athleteToValues = new Map<string, Map<string, number>>();
  for (const [athleteUuid, sessionDate] of latestSessionByAthlete) {
    const sessionKey = `${athleteUuid}\t${sessionDate}`;
    const byName = byAthleteSession.get(sessionKey);
    if (!byName) continue;

    const get = (candidates: string[]) => {
      for (const c of candidates) {
        const v = byName.get(c);
        if (v != null) return v;
      }
      return null;
    };

    const pelvisLfd = get(["PROCESSED.Pelvis_Angle@Lead_Foot_Down_MEAN", "PROCESSED.Pelvis_Angle@Lead_Foot_Down"]);
    const pelvisContact = get(["PROCESSED.Pelvis_Angle@Contact"]);
    const trunkLfd = get(["PROCESSED.Trunk_Angle@Lead_Foot_Down_MEAN", "PROCESSED.Trunk_Angle@Lead_Foot_Down"]);
    const trunkContact = get(["PROCESSED.Trunk_Angle@Contact"]);
    const sepLfd = get(["PROCESSED.Pelvis_Shoulders_Separation@Lead_Foot_Down_MEAN", "PROCESSED.Pelvis_Shoulders_Separation@Lead_Foot_Down"]);
    const kneeLfd = get(["PROCESSED.Lead_Knee_Angle@Lead_Foot_Down_MEAN", "PROCESSED.Lead_Knee_Angle@Lead_Foot_Down"]);
    const kneeContact = get(["PROCESSED.Lead_Knee_Angle@Contact_MEAN", "PROCESSED.Lead_Knee_Angle@Contact"]);

    const out = new Map<string, number>();
    if (pelvisLfd != null) out.set("Pelvis_Angle@Lead_Foot_Down", pelvisLfd);
    if (pelvisContact != null) out.set("Pelvis_Angle@Contact", pelvisContact);
    if (trunkLfd != null) out.set("Trunk_Angle@Lead_Foot_Down", trunkLfd);
    if (trunkContact != null) out.set("Trunk_Angle@Contact", trunkContact);
    if (sepLfd != null) out.set("Pelvis_Shoulders_Separation@Lead_Foot_Down", sepLfd);
    if (kneeLfd != null) out.set("Lead_Knee_Angle@Lead_Foot_Down", kneeLfd);
    if (kneeContact != null) out.set("Lead_Knee_Angle@Contact", kneeContact);
    if (trunkContact != null && trunkLfd != null) out.set("Trunk_Total_Rotation", trunkContact - trunkLfd);
    if (pelvisContact != null && pelvisLfd != null) out.set("Pelvis_Total_Rotation", pelvisContact - pelvisLfd);
    if (kneeContact != null && kneeLfd != null) out.set("Lead_Knee_Extension", kneeLfd - kneeContact);

    if (out.size > 0) athleteToValues.set(athleteUuid, out);
  }
  return athleteToValues;
}

// ---- Metric definitions for output (key -> displayName, orientation) ----
const PITCHING_METRICS: Array<{ key: string; displayName: string; orientation: Orientation }> = [
  { key: "Pelvis_Angle@Footstrike.X", displayName: "Pelvis @ Foot Contact X", orientation: "LOWER_IS_BETTER" },
  { key: "Pelvis_Angle@Footstrike.Y", displayName: "Pelvis @ Foot Contact Y", orientation: "LOWER_IS_BETTER" },
  { key: "Pelvis_Angle@Footstrike.Z", displayName: "Pelvis @ Foot Contact Z", orientation: "LOWER_IS_BETTER" },
  { key: "Pelvis_Angle@Release.X", displayName: "Pelvis @ Release X", orientation: "LOWER_IS_BETTER" },
  { key: "Pelvis_Angle@Release.Y", displayName: "Pelvis @ Release Y", orientation: "LOWER_IS_BETTER" },
  { key: "Pelvis_Angle@Release.Z", displayName: "Pelvis @ Release Z", orientation: "LOWER_IS_BETTER" },
  { key: "Trunk_Angle@Footstrike.X", displayName: "Trunk @ Foot Contact X", orientation: "HIGHER_IS_BETTER" },
  { key: "Trunk_Angle@Footstrike.Y", displayName: "Trunk @ Foot Contact Y", orientation: "HIGHER_IS_BETTER" },
  { key: "Trunk_Angle@Footstrike.Z", displayName: "Trunk @ Foot Contact Z", orientation: "HIGHER_IS_BETTER" },
  { key: "Trunk_Angle@Release.X", displayName: "Trunk @ Release X", orientation: "HIGHER_IS_BETTER" },
  { key: "Trunk_Angle@Release.Y", displayName: "Trunk @ Release Y", orientation: "HIGHER_IS_BETTER" },
  { key: "Trunk_Angle@Release.Z", displayName: "Trunk @ Release Z", orientation: "HIGHER_IS_BETTER" },
  { key: "HipShouldersSep@Footstrike.X", displayName: "Hip-Shoulder Sep @ FC X", orientation: "HIGHER_IS_BETTER" },
  { key: "HipShouldersSep@Footstrike.Y", displayName: "Hip-Shoulder Sep @ FC Y", orientation: "HIGHER_IS_BETTER" },
  { key: "HipShouldersSep@Footstrike.Z", displayName: "Hip-Shoulder Sep @ FC Z", orientation: "HIGHER_IS_BETTER" },
  { key: "Trunk_Translation_FC_Release.X", displayName: "Trunk translation FC→Release X", orientation: "HIGHER_IS_BETTER" },
  { key: "Trunk_Translation_FC_Release.Y", displayName: "Trunk translation FC→Release Y", orientation: "HIGHER_IS_BETTER" },
  { key: "Trunk_Translation_FC_Release.Z", displayName: "Trunk translation FC→Release Z", orientation: "HIGHER_IS_BETTER" },
  { key: "Pelvis_Translation_FC_Release.X", displayName: "Pelvis translation FC→Release X", orientation: "HIGHER_IS_BETTER" },
  { key: "Pelvis_Translation_FC_Release.Y", displayName: "Pelvis translation FC→Release Y", orientation: "HIGHER_IS_BETTER" },
  { key: "Pelvis_Translation_FC_Release.Z", displayName: "Pelvis translation FC→Release Z", orientation: "HIGHER_IS_BETTER" },
  { key: "Knee_Flexion_X_FC_to_Release", displayName: "Knee flexion (X) diff FC→Release", orientation: "HIGHER_IS_BETTER" },
  { key: "Back_Knee_Angle_max.X", displayName: "Back knee angle max X", orientation: "HIGHER_IS_BETTER" },
  { key: "Trunk_Angle@Max_Shoulder_Rot.X", displayName: "Trunk @ Max Shoulder Rot X", orientation: "HIGHER_IS_BETTER" },
  { key: "Trunk_Angle@Max_Shoulder_Rot.Y", displayName: "Trunk @ Max Shoulder Rot Y", orientation: "HIGHER_IS_BETTER" },
  { key: "Trunk_Angle@Max_Shoulder_Rot.Z", displayName: "Trunk @ Max Shoulder Rot Z", orientation: "HIGHER_IS_BETTER" },
];

/** Hitting metrics that are rotation (Z) angles: flip sign when athlete has negative rotation at lead leg off. */
const HITTING_ROTATION_KEYS = new Set([
  "Pelvis_Angle@Lead_Foot_Down",
  "Pelvis_Angle@Contact",
  "Trunk_Angle@Lead_Foot_Down",
  "Trunk_Angle@Contact",
  "Pelvis_Shoulders_Separation@Lead_Foot_Down",
  "Trunk_Total_Rotation",
  "Pelvis_Total_Rotation",
]);

/** Reference for "rotation at lead leg off" (Lead_Foot_Down): Pelvis. If pelvis is negative at this event, flip ALL rotation variables for that trial. */
const LEAD_LEG_OFF_REF_KEY = "Pelvis_Angle@Lead_Foot_Down";

function copyHittingMap(
  src: Map<string, Map<string, number>>
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const [uuid, m] of src) {
    out.set(uuid, new Map(m));
  }
  return out;
}

/** If rotation at Lead_Foot_Down is negative, flip this athlete's rotation metrics so they align with positive side. */
function applyHittingRotationCorrection(
  hittingByAthlete: Map<string, Map<string, number>>
): { corrected: Map<string, Map<string, number>>; flippedCount: number; negativeAtLfd: number; totalWithRef: number } {
  const corrected = copyHittingMap(hittingByAthlete);
  let flippedCount = 0;
  let negativeAtLfd = 0;
  let totalWithRef = 0;
  for (const [, m] of corrected) {
    const refValue = m.get(LEAD_LEG_OFF_REF_KEY);
    if (refValue == null || !Number.isFinite(refValue)) continue;
    totalWithRef++;
    if (refValue < 0) negativeAtLfd++;
    const shouldFlip = refValue < 0;
    if (!shouldFlip) continue;
    flippedCount++;
    for (const key of HITTING_ROTATION_KEYS) {
      const v = m.get(key);
      if (v != null && Number.isFinite(v)) m.set(key, -v);
    }
  }
  return { corrected, flippedCount, negativeAtLfd, totalWithRef };
}

const HITTING_METRICS: Array<{ key: string; displayName: string; orientation: Orientation }> = [
  { key: "Pelvis_Angle@Lead_Foot_Down", displayName: "Pelvis @ Lead Foot Down", orientation: "LOWER_IS_BETTER" },
  { key: "Pelvis_Angle@Contact", displayName: "Pelvis @ Contact", orientation: "LOWER_IS_BETTER" },
  { key: "Trunk_Angle@Lead_Foot_Down", displayName: "Trunk @ Lead Foot Down", orientation: "HIGHER_IS_BETTER" },
  { key: "Trunk_Angle@Contact", displayName: "Trunk @ Contact", orientation: "HIGHER_IS_BETTER" },
  { key: "Pelvis_Shoulders_Separation@Lead_Foot_Down", displayName: "Hip-Shoulder Sep @ Lead Foot Down", orientation: "HIGHER_IS_BETTER" },
  { key: "Trunk_Total_Rotation", displayName: "Trunk translation Lead Foot Down→Contact", orientation: "HIGHER_IS_BETTER" },
  { key: "Pelvis_Total_Rotation", displayName: "Pelvis translation Lead Foot Down→Contact", orientation: "HIGHER_IS_BETTER" },
  { key: "Lead_Knee_Extension", displayName: "Knee flexion diff Lead Foot Down→Contact", orientation: "HIGHER_IS_BETTER" },
  { key: "Lead_Knee_Angle@Lead_Foot_Down", displayName: "Lead Knee @ Lead Foot Down", orientation: "HIGHER_IS_BETTER" },
  { key: "Lead_Knee_Angle@Contact", displayName: "Lead Knee @ Contact", orientation: "HIGHER_IS_BETTER" },
];

function computeThresholds(
  athleteToValues: Map<string, Map<string, number>>,
  spec: Array<{ key: string; displayName: string; orientation: Orientation }>,
  domain: "pitching" | "hitting"
): ThresholdMetric[] {
  const results: ThresholdMetric[] = [];
  for (const { key, displayName, orientation } of spec) {
    const values: number[] = [];
    for (const m of athleteToValues.values()) {
      const v = m.get(key);
      if (v != null && Number.isFinite(v)) values.push(v);
    }
    if (values.length === 0) continue;
    values.sort((a, b) => a - b);
    results.push({
      metricKey: key,
      displayName,
      domain,
      orientation,
      percentiles: {
        p15: Math.round(percentile(values, 15) * 1000) / 1000,
        p33: Math.round(percentile(values, 33) * 1000) / 1000,
        p66: Math.round(percentile(values, 66) * 1000) / 1000,
        p85: Math.round(percentile(values, 85) * 1000) / 1000,
      },
      n: values.length,
    });
  }
  return results;
}

/** Diagnostic: print all distinct metric_name values in f_kinematics_hitting that look like
 *  rotation/angle metrics, with a sample value, so we can find the correct rotation key. */
async function diagnoseFKinematicsHitting() {
  console.log("\n--- [DIAGNOSTIC] f_kinematics_hitting: distinct Trunk/Pelvis angle metric names ---");
  const rows = await prisma.f_kinematics_hitting.findMany({
    where: {
      metric_name: { contains: "_Angle" },
    },
    select: { metric_name: true, value: true },
    distinct: ["metric_name"],
    take: 200,
  });

  // Group by metric name and show sample value
  const byName = new Map<string, number | null>();
  for (const r of rows) {
    if (!byName.has(r.metric_name)) {
      byName.set(r.metric_name, decimalToNumber(r.value));
    }
  }

  // Sort and print — flag ones that look like rotation (absolute value > 20)
  const sorted = Array.from(byName.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [name, val] of sorted) {
    const flag = val != null && Math.abs(val) > 20 ? " *** POSSIBLE ROTATION ***" : "";
    console.log(`  ${name}: ${val != null ? val.toFixed(2) : "null"}${flag}`);
  }
  console.log(`  Total distinct angle metric names: ${sorted.length}`);
  console.log("--- [DIAGNOSTIC END] ---\n");
}

async function main() {
  await diagnoseFKinematicsHitting();

  console.log("Loading pitching data (best trial per athlete by velocity)...");
  const pitchingByAthlete = await getPitchingValuesByAthlete();
  console.log("Pitching athletes:", pitchingByAthlete.size);

  console.log("Loading hitting data (most recent session per athlete)...");
  const hittingByAthlete = await getHittingValuesByAthlete();
  console.log("Hitting athletes:", hittingByAthlete.size);

  console.log("Loading hitting trials (f_hitting_trials) for Trunk/Pelvis X metrics...");
  const { byAthlete: hittingTrialsByAthlete, trialAthleteUuids, notInDAthletes } =
    await getHittingTrialsMetricsByAthlete();
  console.log("Hitting trials: distinct athletes in f_hitting_trials:", trialAthleteUuids.length);
  if (notInDAthletes.length > 0) {
    console.warn("Hitting trials: athlete_uuids NOT in d_athletes:", notInDAthletes.length, notInDAthletes);
  }
  for (const [athleteUuid, trialMetrics] of hittingTrialsByAthlete) {
    let map = hittingByAthlete.get(athleteUuid);
    if (!map) {
      map = new Map();
      hittingByAthlete.set(athleteUuid, map);
    }
    for (const [k, v] of trialMetrics) map.set(k, v);
  }
  console.log("Hitting athletes with trial rotation metrics extracted:", hittingTrialsByAthlete.size);

  const pitchingThresholds = computeThresholds(
    pitchingByAthlete,
    PITCHING_METRICS,
    "pitching"
  );
  const hittingThresholds = computeThresholds(
    hittingByAthlete,
    HITTING_METRICS,
    "hitting"
  );

  // Hitting rotation correction: flip sign for athletes with negative rotation at Lead_Foot_Down (lead leg off)
  const { corrected: hittingByAthleteCorrected, flippedCount, negativeAtLfd, totalWithRef } =
    applyHittingRotationCorrection(hittingByAthlete);
  console.log(
    "[Hitting rotation] Athletes with rotation at Lead_Foot_Down:",
    totalWithRef,
    "| Negative (flipped to positive):",
    negativeAtLfd,
    "| Flipped count:",
    flippedCount
  );
  if (totalWithRef > 0 && (negativeAtLfd === 0 || negativeAtLfd === totalWithRef)) {
    console.log("[Hitting rotation] All same sign at Lead_Foot_Down — no left/right mix or no correction needed.");
  } else if (totalWithRef > 0) {
    console.log("[Hitting rotation] Mixed signs — applied flip so negative-at-LFD athletes now positive.");
  }

  const hittingThresholdsCorrected = computeThresholds(
    hittingByAthleteCorrected,
    HITTING_METRICS,
    "hitting"
  );
  const allCorrected: ThresholdMetric[] = [...pitchingThresholds, ...hittingThresholdsCorrected];

  const all: ThresholdMetric[] = [...pitchingThresholds, ...hittingThresholds];

  const output = {
    generatedAt: new Date().toISOString(),
    legend: {
      Bad: "≤ 33rd percentile (higher-is-better) or ≥ 66th (lower-is-better)",
      Average: "33rd–66th percentile",
      Good: "≥ 66th percentile (higher-is-better) or ≤ 33rd (lower-is-better)",
      VeryBad: "≤ 15th (higher-is-better) or ≥ 85th (lower-is-better)",
      Elite: "≥ 85th (higher-is-better) or ≤ 15th (lower-is-better)",
    },
    pitching: { nAthletes: pitchingByAthlete.size, metrics: pitchingThresholds },
    hitting: { nAthletes: hittingByAthlete.size, metrics: hittingThresholds },
    all,
  };

  const fs = await import("fs");
  const path = await import("path");
  const outDir = path.resolve(OUTPUT_DIR);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, "kinematics-thresholds.json");
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2), "utf-8");
  console.log("Wrote", jsonPath);

  // CSV
  const csvRows = [
    "domain,metricKey,displayName,orientation,n,p15,p33,p66,p85",
    ...all.map(
      (m) =>
        `${m.domain},${m.metricKey},${m.displayName},${m.orientation},${m.n},${m.percentiles.p15},${m.percentiles.p33},${m.percentiles.p66},${m.percentiles.p85}`
    ),
  ];
  const csvPath = path.join(outDir, "kinematics-thresholds.csv");
  fs.writeFileSync(csvPath, csvRows.join("\n"), "utf-8");
  console.log("Wrote", csvPath);

  // Corrected CSV: hitting rotation angles flipped so negative-at-Lead_Foot_Down athletes are normalized to positive
  const csvRowsCorrected = [
    "domain,metricKey,displayName,orientation,n,p15,p33,p66,p85",
    ...allCorrected.map(
      (m) =>
        `${m.domain},${m.metricKey},${m.displayName},${m.orientation},${m.n},${m.percentiles.p15},${m.percentiles.p33},${m.percentiles.p66},${m.percentiles.p85}`
    ),
  ];
  const csvCorrectedPath = path.join(outDir, "kinematics-thresholds-corrected.csv");
  fs.writeFileSync(csvCorrectedPath, csvRowsCorrected.join("\n"), "utf-8");
  console.log("Wrote", csvCorrectedPath);

  const outputCorrected = {
    generatedAt: new Date().toISOString(),
    note: "Hitting rotation (Z) angles corrected: athletes with negative rotation at Lead_Foot_Down had those metrics flipped to positive (same convention as right-handed coordinate system).",
    legend: output.legend,
    pitching: output.pitching,
    hitting: { nAthletes: hittingByAthleteCorrected.size, metrics: hittingThresholdsCorrected },
    all: allCorrected,
  };
  const jsonCorrectedPath = path.join(outDir, "kinematics-thresholds-corrected.json");
  fs.writeFileSync(jsonCorrectedPath, JSON.stringify(outputCorrected, null, 2), "utf-8");
  console.log("Wrote", jsonCorrectedPath);

  console.log("\nDone. Pitching metrics:", pitchingThresholds.length, "| Hitting metrics:", hittingThresholds.length);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
