/**
 * Queries pitching trials from the DB, computes each metric value per athlete
 * (replicating pitchingPayload.ts logic), then outputs percentile thresholds
 * (15th, 40th, 60th, 85th) for each metric to hereyougobobbyareyouhappynow.csv
 *
 * Run: node scripts/compute_pitching_percentiles.js
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Load .env manually
// ---------------------------------------------------------------------------
const envPath = path.join(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// Helpers (mirror pitchingPayload.ts)
// ---------------------------------------------------------------------------
function decimalToNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value.toNumber === "function") return value.toNumber();
  if (typeof value.toString === "function") {
    const n = Number(value.toString());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function roundTo(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function parseTrialMetricsJson(metrics) {
  const out = new Map();
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return out;
  for (const [key, val] of Object.entries(metrics)) {
    const scalar = Array.isArray(val) && val.length > 0 ? val[0] : val;
    const num = decimalToNumber(scalar);
    out.set(key, num);
    if (key.endsWith(".X")) {
      const base = key.slice(0, -2);
      if (!out.has(base)) out.set(base, num);
    }
    if (key.endsWith("_X") || key.endsWith("_Y") || key.endsWith("_Z")) {
      const suffix = key.slice(-2);
      const base = key.slice(0, -2);
      const dotKey = `${base}.${suffix === "_X" ? "X" : suffix === "_Y" ? "Y" : "Z"}`;
      if (!out.has(dotKey)) out.set(dotKey, num);
    }
    if (key.includes(".") && (key.endsWith(".Y") || key.endsWith(".Z"))) {
      const base = key.slice(0, -2);
      const underscore = key.endsWith(".Y") ? "_Y" : "_Z";
      const altKey = base + underscore;
      if (!out.has(altKey)) out.set(altKey, num);
    }
  }
  return out;
}

function getFromMap(map, key) {
  const v = map.get(key);
  if (v !== undefined) return v;
  if (key.endsWith("_X")) return map.get(key.slice(0, -2) + ".X") ?? null;
  if (key.endsWith("_Y")) return map.get(key.slice(0, -2) + ".Y") ?? null;
  if (key.endsWith("_Z")) return map.get(key.slice(0, -2) + ".Z") ?? null;
  return null;
}

function computeProgressionSummary(map, opts) {
  const footstrike = getFromMap(map, `${opts.footstrikeKey}_${opts.axis}`);
  if (footstrike == null) return { gainOrLoss: null, amountToPeak: null, peakAfterFootstrikeMs: null, postPeakLossRate: null };

  const points = [{ ms: 0, value: footstrike }];
  for (let ms = 10; ms <= 110; ms += 10) {
    const value = getFromMap(map, `${opts.incrementPrefix}_${ms}ms_${opts.axis}`);
    if (value != null) points.push({ ms, value });
  }

  let peakPoint = points[0];
  for (const p of points) {
    if (opts.lowerIsGain ? p.value < peakPoint.value : p.value > peakPoint.value) peakPoint = p;
  }

  const amountToPeak = opts.lowerIsGain ? footstrike - peakPoint.value : peakPoint.value - footstrike;
  const gainOrLoss = amountToPeak > 0 ? 1 : amountToPeak < 0 ? -1 : 0;
  const peakAfterFootstrikeMs = peakPoint.ms > 0 ? peakPoint.ms : null;
  const laterPoints = points.filter((p) => p.ms > peakPoint.ms);
  let postPeakLossRate = null;
  if (laterPoints.length > 0) {
    const last = laterPoints[laterPoints.length - 1];
    const loss = opts.lowerIsGain ? last.value - peakPoint.value : peakPoint.value - last.value;
    const dt = last.ms - peakPoint.ms;
    postPeakLossRate = dt > 0 ? loss / dt : null;
  }
  return { gainOrLoss, amountToPeak, peakAfterFootstrikeMs, postPeakLossRate };
}

// ---------------------------------------------------------------------------
// Metric extraction — given a parsed metrics map, return { key -> value }
// ---------------------------------------------------------------------------
function extractMetrics(map, weightLbs) {
  const velocityMph = map.get("BALLSPEED.BALL_RELEASE_SPEED") ?? null;
  const results = {};

  // TRACKMAN_METRICS|VELOCITY
  results["TRACKMAN_METRICS|VELOCITY"] = velocityMph;

  // SUBJECT_METRICS|SCORE
  results["SUBJECT_METRICS|SCORE"] = typeof velocityMph === "number" ? velocityMph * 3.125 : null;

  // PELVIS_ROTATION|FOOT_PLANT
  results["PELVIS_ROTATION|FOOT_PLANT"] =
    map.get("PROCESSED.Pelvis_Angle@Footstrike.Z") ?? map.get("PROCESSED.Pelvis_Angle@Footstrike_Z") ?? null;

  // TRUNK_POSITION|FOOT_PLANT
  results["TRUNK_POSITION|FOOT_PLANT"] =
    map.get("PROCESSED.Trunk_Angle@Footstrike.Z") ?? map.get("PROCESSED.Trunk_Angle@Footstrike_Z") ?? null;

  // HIP_SHOULDER_SEPARATION|FOOT_PLANT
  results["HIP_SHOULDER_SEPARATION|FOOT_PLANT"] =
    map.get("PROCESSED.Hip Shoulders Sep@Footstrike.Z") ?? map.get("PROCESSED.Hip Shoulders Sep@Footstrike_Z") ?? null;

  // FRONT_LEG|FOOT_PLANT
  results["FRONT_LEG|FOOT_PLANT"] =
    map.get("PROCESSED.Lead_Knee_Angle@Footstrike.X") ?? map.get("PROCESSED.Lead_Knee_Angle@Footstrike_X") ?? null;

  // FRONT_LEG|RELEASE
  results["FRONT_LEG|RELEASE"] =
    map.get("PROCESSED.Lead_Knee_Angle@Release.X") ?? map.get("PROCESSED.Lead_Knee_Angle@Release_X") ?? null;

  // FRONT_LEG|EXTENSION = footstrike - release
  {
    const release = getFromMap(map, "PROCESSED.Lead_Knee_Angle@Release_X");
    const footstrike = getFromMap(map, "PROCESSED.Lead_Knee_Angle@Footstrike_X");
    results["FRONT_LEG|EXTENSION"] = release != null && footstrike != null ? footstrike - release : null;
  }

  // SHOULDER_ER|FOOT_PLANT
  results["SHOULDER_ER|FOOT_PLANT"] =
    map.get("PROCESSED.Pitching_Shoulder_Angle@Footstrike_Z") ?? map.get("PROCESSED.Pitching_Shoulder_Angle@Footstrike.Z") ?? null;

  // SHOULDER_ER|MAX
  results["SHOULDER_ER|MAX"] =
    map.get("PROCESSED.Pitching_Shoulder_Angle_Max_Z") ?? map.get("PROCESSED.Pitching_Shoulder_Angle_Max.Z") ?? null;

  // ABDUCTION|FOOT_PLANT
  results["ABDUCTION|FOOT_PLANT"] =
    map.get("PROCESSED.Pitching_Shoulder_Angle@Footstrike.X") ?? map.get("PROCESSED.Pitching_Shoulder_Angle@Footstrike_X") ?? null;

  // ABDUCTION|MAX
  results["ABDUCTION|MAX"] = map.get("PROCESSED.Pitching_Shoulder_Angle_Min") ?? null;

  // KINEMATIC_SEQUENCE|PELVIS
  results["KINEMATIC_SEQUENCE|PELVIS"] =
    map.get("KINEMATIC_SEQUENCE.Pelvis_Ang_Vel_max.X") ?? map.get("KINEMATIC_SEQUENCE.Pelvis_Ang_Vel_max") ?? null;

  // KINEMATIC_SEQUENCE|TORSO
  results["KINEMATIC_SEQUENCE|TORSO"] =
    map.get("KINEMATIC_SEQUENCE.Thorax_Ang_Vel_max.X") ?? map.get("KINEMATIC_SEQUENCE.Thorax_Ang_Vel_max") ?? null;

  // KINEMATIC_SEQUENCE|ARM
  results["KINEMATIC_SEQUENCE|ARM"] =
    map.get("KINEMATIC_SEQUENCE.Pitching_Humerus_Ang_Vel_max.X") ?? map.get("KINEMATIC_SEQUENCE.Pitching_Humerus_Ang_Vel_max") ?? null;

  // KINEMATIC_SEQUENCE|HAND
  results["KINEMATIC_SEQUENCE|HAND"] =
    map.get("KINEMATIC_SEQUENCE.Pitching_Hand_Ang_Vel_max.X") ?? map.get("KINEMATIC_SEQUENCE.Pitching_Hand_Ang_Vel_max") ?? null;

  // GRF|MID_POINT
  results["GRF|MID_POINT"] =
    map.get("PROCESSED.Lead_Leg_GRF_mag_Midpoint_FS_Release.X") ?? map.get("PROCESSED.Lead_Leg_GRF_mag_Midpoint_FS_Release_X") ?? null;

  // LATERAL_TILT|RELEASE
  results["LATERAL_TILT|RELEASE"] =
    map.get("PROCESSED.Trunk_Angle@Release.X") ?? map.get("PROCESSED.Trunk_Angle@Release_X") ?? null;

  // SHOULDER_EXTERNAL_ROTATION|MAX
  results["SHOULDER_EXTERNAL_ROTATION|MAX"] =
    map.get("PROCESSED.Pitching_Shoulder_Angle_XYZ@Max_Shoulder_Rot.Z") ??
    map.get("PROCESSED.Pitching_Shoulder_Angle_XYZ@Max_Shoulder_Rot_Z") ?? null;

  // PELVIC_OBLIQUITY|TOTAL = release_Y - footstrike_Y
  {
    const release = getFromMap(map, "PROCESSED.Pelvis_Angle@Release_Y");
    const footstrike = getFromMap(map, "PROCESSED.Pelvis_Angle@Footstrike_Y");
    results["PELVIC_OBLIQUITY|TOTAL"] = release != null && footstrike != null ? release - footstrike : null;
  }

  // TOTAL_TRUNK_FLEXION|TOTAL = release_X - footstrike_X
  {
    const release = getFromMap(map, "PROCESSED.Trunk_Angle@Release_X");
    const footstrike = getFromMap(map, "PROCESSED.Trunk_Angle@Footstrike_X");
    results["TOTAL_TRUNK_FLEXION|TOTAL"] = release != null && footstrike != null ? release - footstrike : null;
  }

  // ABDUCTION_PROGRESS
  {
    const prog = computeProgressionSummary(map, {
      footstrikeKey: "PROCESSED.Pitching_Shoulder_Angle@Footstrike",
      incrementPrefix: "INCREMENT.Pitching_Shoulder_Angle@Footstrike",
      axis: "X",
      lowerIsGain: true,
    });
    results["ABDUCTION_PROGRESS|GAIN_OR_LOSS"] = prog.gainOrLoss;
    results["ABDUCTION_PROGRESS|AMOUNT_TO_PEAK"] = prog.amountToPeak;
    results["ABDUCTION_PROGRESS|PEAK_AFTER_FOOTSTRIKE_MS"] = prog.peakAfterFootstrikeMs;
    results["ABDUCTION_PROGRESS|POST_PEAK_LOSS_RATE"] = prog.postPeakLossRate;
  }

  // ABDUCTION|TIME_TO_MAX_HOR_ANGLE_MS
  {
    const maxTime = getFromMap(map, "TIMING.MaxShoulderHorAngleTime_X");
    const footstrikeTime = getFromMap(map, "TIMING.FootstrikeTime_X");
    results["ABDUCTION|TIME_TO_MAX_HOR_ANGLE_MS"] =
      maxTime != null && footstrikeTime != null ? roundTo((maxTime - footstrikeTime) * 1000, 2) : null;
  }

  // HIP_SHOULDER_PROGRESS
  {
    const prog = computeProgressionSummary(map, {
      footstrikeKey: "PROCESSED.Hip Shoulders Sep@Footstrike",
      incrementPrefix: "INCREMENT.Hip Shoulders Sep@Footstrike",
      axis: "Z",
      lowerIsGain: false,
    });
    results["HIP_SHOULDER_PROGRESS|GAIN_OR_LOSS"] = prog.gainOrLoss;
    results["HIP_SHOULDER_PROGRESS|AMOUNT_TO_PEAK"] = prog.amountToPeak;
    results["HIP_SHOULDER_PROGRESS|PEAK_AFTER_FOOTSTRIKE_MS"] = prog.peakAfterFootstrikeMs;
    results["HIP_SHOULDER_PROGRESS|POST_PEAK_LOSS_RATE"] = prog.postPeakLossRate;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Percentile computation
// ---------------------------------------------------------------------------
function percentileValue(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const frac = idx - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

// ---------------------------------------------------------------------------
// Report structure (mirrors AthleteTrackingContent.tsx PITCHING_TABLE_SECTIONS)
// ---------------------------------------------------------------------------
const REPORT_ROWS = [
  { section: "Velocity / Score",              label: "Velocity",                          key: "TRACKMAN_METRICS|VELOCITY",                    unit: "mph",      orientation: "Higher is Better" },
  { section: "Velocity / Score",              label: "Score",                             key: "SUBJECT_METRICS|SCORE",                        unit: "",         orientation: "Higher is Better" },
  { section: "Ground Reaction Force",         label: "GRF Mid-Point",                     key: "GRF|MID_POINT",                                unit: "N/BW",     orientation: "Higher is Better" },
  { section: "Lead Leg Block",                label: "Lead Leg Block",                    key: "FRONT_LEG|EXTENSION",                          unit: "°",        orientation: "Higher is Better" },
  { section: "Lead Leg Block",                label: "Knee Flexion @ Footplant",          key: "FRONT_LEG|FOOT_PLANT",                         unit: "°",        orientation: "Higher is Better" },
  { section: "Lead Leg Block",                label: "Knee Flexion @ Release",            key: "FRONT_LEG|RELEASE",                            unit: "°",        orientation: "Higher is Better" },
  { section: "Pelvis Rotation",               label: "Pelvis @ Footplant",                key: "PELVIS_ROTATION|FOOT_PLANT",                   unit: "°",        orientation: "Lower is Better"  },
  { section: "Pelvis Rotation",               label: "Pelvic Obliquity (FP to Release)",  key: "PELVIC_OBLIQUITY|TOTAL",                       unit: "°",        orientation: "Lower is Better"  },
  { section: "Hip-Shoulder Separation",       label: "HSS @ Footplant",                   key: "HIP_SHOULDER_SEPARATION|FOOT_PLANT",           unit: "°",        orientation: "Higher is Better" },
  { section: "Hip-Shoulder Separation",       label: "Gain or Loss",                      key: "HIP_SHOULDER_PROGRESS|GAIN_OR_LOSS",           unit: "",         orientation: "Higher is Better" },
  { section: "Hip-Shoulder Separation",       label: "Diff FP to Peak",                   key: "HIP_SHOULDER_PROGRESS|AMOUNT_TO_PEAK",         unit: "°",        orientation: "Higher is Better" },
  { section: "Hip-Shoulder Separation",       label: "Time to Peak",                      key: "HIP_SHOULDER_PROGRESS|PEAK_AFTER_FOOTSTRIKE_MS", unit: "ms",     orientation: "Lower is Better"  },
  { section: "Hip-Shoulder Separation",       label: "Rate of Loss",                      key: "HIP_SHOULDER_PROGRESS|POST_PEAK_LOSS_RATE",    unit: "",         orientation: "Lower is Better"  },
  { section: "Torso Position",                label: "Torso @ Footplant",                 key: "TRUNK_POSITION|FOOT_PLANT",                    unit: "°",        orientation: "Higher is Better" },
  { section: "Torso Position",                label: "Total Torso Flexion (FP to Release)", key: "TOTAL_TRUNK_FLEXION|TOTAL",                  unit: "°",        orientation: "Higher is Better" },
  { section: "Torso Position",                label: "Lateral Tilt @ Release",            key: "LATERAL_TILT|RELEASE",                         unit: "°",        orientation: "Higher is Better" },
  { section: "Horizontal Abduction (Scap Load)", label: "Abduction @ Footplant",          key: "ABDUCTION|FOOT_PLANT",                         unit: "°",        orientation: "Higher is Better" },
  { section: "Horizontal Abduction (Scap Load)", label: "Max Abduction",                  key: "ABDUCTION|MAX",                                unit: "°",        orientation: "Higher is Better" },
  { section: "Horizontal Abduction (Scap Load)", label: "Gain or Loss",                   key: "ABDUCTION_PROGRESS|GAIN_OR_LOSS",              unit: "",         orientation: "Higher is Better" },
  { section: "Horizontal Abduction (Scap Load)", label: "Diff FP to Peak",                key: "ABDUCTION_PROGRESS|AMOUNT_TO_PEAK",            unit: "°",        orientation: "Higher is Better" },
  { section: "Horizontal Abduction (Scap Load)", label: "Time to Peak",                   key: "ABDUCTION_PROGRESS|PEAK_AFTER_FOOTSTRIKE_MS", unit: "ms",        orientation: "Lower is Better"  },
  { section: "Horizontal Abduction (Scap Load)", label: "Rate of Loss",                   key: "ABDUCTION_PROGRESS|POST_PEAK_LOSS_RATE",       unit: "",         orientation: "Lower is Better"  },
  { section: "Shoulder External Rotation",    label: "Shoulder ER @ Footplant",           key: "SHOULDER_ER|FOOT_PLANT",                       unit: "°",        orientation: "Higher is Better" },
  { section: "Shoulder External Rotation",    label: "Max External Rotation (Layback)",   key: "SHOULDER_EXTERNAL_ROTATION|MAX",               unit: "°",        orientation: "Higher is Better" },
  { section: "Kinematic Sequence",            label: "Pelvis Ang Velo",                   key: "KINEMATIC_SEQUENCE|PELVIS",                    unit: "°/s",      orientation: "Higher is Better" },
  { section: "Kinematic Sequence",            label: "Torso Ang Velo",                    key: "KINEMATIC_SEQUENCE|TORSO",                     unit: "°/s",      orientation: "Higher is Better" },
  { section: "Kinematic Sequence",            label: "Arm Ang Velo",                      key: "KINEMATIC_SEQUENCE|ARM",                       unit: "°/s",      orientation: "Higher is Better" },
  { section: "Kinematic Sequence",            label: "Max External Rotation",             key: "SHOULDER_EXTERNAL_ROTATION|MAX",               unit: "°",        orientation: "Higher is Better" },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("Fetching all athletes with pitching data...");

  // Get unique athlete UUIDs that have pitching trials
  const athleteRows = await prisma.f_pitching_trials.findMany({
    select: { athlete_uuid: true },
    distinct: ["athlete_uuid"],
    take: 150,
  });

  const athleteUuids = athleteRows.map((r) => r.athlete_uuid);
  console.log(`Found ${athleteUuids.length} athletes with pitching trials.`);

  // For each athlete, get their best trial (highest velocity)
  const allMetricValues = {}; // key -> number[]
  for (const key of REPORT_ROWS.map((r) => r.key)) allMetricValues[key] = [];

  let processed = 0;
  for (const uuid of athleteUuids) {
    const bestTrial = await prisma.f_pitching_trials.findFirst({
      where: { athlete_uuid: uuid },
      orderBy: [{ velocity_mph: "desc" }, { session_date: "desc" }, { trial_index: "asc" }],
      select: { metrics: true, velocity_mph: true, weight: true },
    });

    if (!bestTrial) continue;

    const map = parseTrialMetricsJson(bestTrial.metrics);
    const velocityFromRow = decimalToNumber(bestTrial.velocity_mph);
    if (velocityFromRow !== null) map.set("BALLSPEED.BALL_RELEASE_SPEED", velocityFromRow);

    const weightLbs = decimalToNumber(bestTrial.weight);
    const metrics = extractMetrics(map, weightLbs);

    for (const key of Object.keys(allMetricValues)) {
      const val = metrics[key];
      if (typeof val === "number" && Number.isFinite(val)) {
        allMetricValues[key].push(val);
      }
    }

    processed++;
    if (processed % 10 === 0) process.stdout.write(`  Processed ${processed}/${athleteUuids.length}\r`);
  }

  console.log(`\nProcessed ${processed} athletes. Computing percentiles...`);

  // Sort all values ascending
  const sorted = {};
  for (const key of Object.keys(allMetricValues)) {
    sorted[key] = [...allMetricValues[key]].sort((a, b) => a - b);
  }

  // Build CSV
  const header = "Section,Metric (UI Label),Unit,Orientation,N (athletes),<15th %ile,15-40th %ile,41-60th %ile,61-85th %ile,>85th %ile";
  const lines = [header];

  // Deduplicate by key (SHOULDER_EXTERNAL_ROTATION|MAX appears in 2 sections)
  // but we keep all rows as defined since labels differ per section
  for (const row of REPORT_ROWS) {
    const vals = sorted[row.key] || [];
    const n = vals.length;
    const fmt = (v) => (v == null ? "" : v.toFixed(2));

    const p15 = fmt(percentileValue(vals, 15));
    const p40 = fmt(percentileValue(vals, 40));
    const p60 = fmt(percentileValue(vals, 60));
    const p85 = fmt(percentileValue(vals, 85));

    // For "Lower is Better" metrics, the percentile rank is inverted in the app
    // (lower value = better), so label the columns accordingly
    const bandLabel = row.orientation === "Lower is Better"
      ? "<15 (Best)   |   15-40   |   41-60   |   61-85   |   >85 (Worst)"
      : "<15 (Worst)  |   15-40   |   41-60   |   61-85   |   >85 (Best)";

    const csvRow = [
      `"${row.section}"`,
      `"${row.label}"`,
      `"${row.unit}"`,
      `"${row.orientation}"`,
      n,
      p15,
      p40,
      p60,
      p85,
    ].join(",");

    lines.push(csvRow);
  }

  const outPath = path.join(__dirname, "../hereyougobobbyareyouhappynow.csv");
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`\nDone! CSV written to: ${outPath}`);
  console.log(`\nNote: For 'Higher is Better' metrics — >85th %ile = elite, <15th = needs work.`);
  console.log(`      For 'Lower is Better' metrics — <15th %ile = elite, >85th = needs work.\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
