/**
 * Backfill script: normalize GRF metrics in f_pitching_trials
 *
 * Problem: before a 2024 pipeline update, Lead Leg GRF values were output as
 * raw Newtons (e.g. 2485). After the update they are correctly output as
 * N/BW (Newtons / body-weight-in-Newtons, e.g. ~2.5).
 *
 * Fix: for any trial where a GRF metric key is > 100, divide by the athlete's
 * bodyweight-in-Newtons (weight_lbs / 2.20462 * 9.81) to convert to N/BW.
 *
 * GRF metric keys affected (inside the metrics JSON blob):
 *   - PROCESSED.Lead_Leg_GRF_mag_Midpoint_FS_Release.X  (→ GRF|MID_POINT)
 *   - PROCESSED.Lead_Leg_GRF_mag_Midpoint_FS_Release_X  (underscore variant)
 *   - PROCESSED.Lead_Leg_GRF_mag_max.X                  (→ GRF|GRF_MAG_MAX)
 *   - PROCESSED.Lead_Leg_GRF_mag_max_X
 *   - PROCESSED.Lead_Leg_GRF_min_Y                      (→ GRF|Y_DIR)
 *   - PROCESSED.Lead_Leg_GRF_max.Z                      (→ GRF|Z_DIR)
 *   - PROCESSED.Lead_Leg_GRF_max_Z
 *
 * Usage:
 *   npx tsx scripts/backfill-grf-normalization.ts              (dry run — shows what would change)
 *   npx tsx scripts/backfill-grf-normalization.ts --write      (commit changes to DB)
 */

import { prisma } from "../lib/db/prisma";

const WRITE = process.argv.includes("--write");

/** Keys inside the metrics JSON blob that hold raw/normalised GRF values. */
const GRF_KEYS = [
  "PROCESSED.Lead_Leg_GRF_mag_Midpoint_FS_Release.X",
  "PROCESSED.Lead_Leg_GRF_mag_Midpoint_FS_Release_X",
  "PROCESSED.Lead_Leg_GRF_mag_max.X",
  "PROCESSED.Lead_Leg_GRF_mag_max_X",
  "PROCESSED.Lead_Leg_GRF_min_Y",
  "PROCESSED.Lead_Leg_GRF_max.Z",
  "PROCESSED.Lead_Leg_GRF_max_Z",
];

/** Threshold above which a value is assumed to be raw Newtons (not N/BW). */
const RAW_THRESHOLD = 100;

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const scalar = Array.isArray(v) && v.length > 0 ? v[0] : v;
  if (typeof scalar === "number") return scalar;
  const n = Number(scalar);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  console.log("=".repeat(80));
  console.log("GRF NORMALIZATION BACKFILL");
  console.log(WRITE ? "  MODE: WRITE — changes will be committed to DB" : "  MODE: DRY RUN — no writes (add --write to commit)");
  console.log("=".repeat(80));
  console.log();

  // Load all pitching trials that have a weight on record
  const trials = await prisma.f_pitching_trials.findMany({
    select: { id: true, athlete_uuid: true, session_date: true, weight: true, metrics: true },
    orderBy: [{ session_date: "asc" }],
  });

  console.log(`Loaded ${trials.length} pitching trials.\n`);

  let nFixed = 0;
  let nSkippedNoWeight = 0;
  let nSkippedAlreadyNorm = 0;
  let nNoGrfKeys = 0;

  for (const trial of trials) {
    const weightLbs = toNumber(trial.weight);
    if (weightLbs === null || weightLbs <= 0) {
      nSkippedNoWeight++;
      continue;
    }

    // bodyweight in Newtons = (lbs / 2.20462) * 9.81
    const bodyWeightN = (weightLbs / 2.20462) * 9.81;

    const metricsObj = trial.metrics as Record<string, unknown> | null;
    if (!metricsObj || typeof metricsObj !== "object" || Array.isArray(metricsObj)) {
      nNoGrfKeys++;
      continue;
    }

    // Check if any GRF key needs normalisation
    const keysPresent = GRF_KEYS.filter((k) => k in metricsObj);
    if (keysPresent.length === 0) {
      nNoGrfKeys++;
      continue;
    }

    let needsFix = false;
    const updates: Record<string, number> = {};

    for (const key of keysPresent) {
      const raw = toNumber(metricsObj[key]);
      if (raw === null) continue;
      const absRaw = Math.abs(raw);
      if (absRaw > RAW_THRESHOLD) {
        // Preserve sign (Y_DIR uses absolute value downstream, but keep sign in storage)
        const normalized = raw / bodyWeightN;
        updates[key] = normalized;
        needsFix = true;
      }
    }

    if (!needsFix) {
      nSkippedAlreadyNorm++;
      continue;
    }

    // Build updated metrics blob
    const updatedMetrics = { ...metricsObj, ...updates };

    const dateStr = trial.session_date.toISOString().slice(0, 10);
    const keysChanged = Object.keys(updates);
    console.log(
      `[${trial.id}] ${trial.athlete_uuid}  date=${dateStr}  weight=${weightLbs.toFixed(1)} lbs  bodyWt=${bodyWeightN.toFixed(1)} N`
    );
    for (const k of keysChanged) {
      const oldVal = toNumber(metricsObj[k]);
      const newVal = updates[k]!;
      console.log(`  ${k}`);
      console.log(`    before: ${oldVal?.toFixed(4)}  after: ${newVal.toFixed(4)}`);
    }

    if (WRITE) {
      await prisma.f_pitching_trials.update({
        where: { id: trial.id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { metrics: updatedMetrics as any },
      });
    }

    nFixed++;
  }

  console.log();
  console.log("=".repeat(80));
  console.log("SUMMARY");
  console.log(`  Trials scanned:           ${trials.length}`);
  console.log(`  Fixed (or would fix):     ${nFixed}`);
  console.log(`  Already normalised:       ${nSkippedAlreadyNorm}`);
  console.log(`  Skipped (no weight):      ${nSkippedNoWeight}`);
  console.log(`  Skipped (no GRF keys):    ${nNoGrfKeys}`);
  if (!WRITE && nFixed > 0) {
    console.log();
    console.log("  *** DRY RUN — re-run with --write to apply fixes ***");
  }
  console.log("=".repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
