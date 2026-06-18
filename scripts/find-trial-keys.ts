/**
 * Finds matching keys in f_pitching_trials metrics JSON for specific patterns.
 * Run: npx tsx scripts/find-trial-keys.ts
 */
import { prisma } from "../lib/db/prisma";

const PATTERNS = [
  "PROCESSED.Pelvis_Angle@Footstrike",
  "PROCESSED.Pitching_Shoulder_Angle_XYZ@Max_Shoulder_Rot",
  "PROCESSED.Pitching_Shoulder_Angle@Footstrike",
  "PROCESSED.Pitching_Shoulder_Angle_XYZ@Footstrike",
  "PROCESSED.Trunk_Angle@Footstrike",
  "PROCESSED.Lead_Leg_GRF_mag_Midpoint_FS_Release",
];

async function main() {
  const row = await prisma.f_pitching_trials.findFirst({
    orderBy: { session_date: "desc" },
    select: { metrics: true, athlete_uuid: true, session_date: true },
  });

  if (!row?.metrics || typeof row.metrics !== "object") {
    console.log("No row found");
    return;
  }

  const metrics = row.metrics as Record<string, unknown>;
  const allKeys = Object.keys(metrics).sort();

  console.log(`Athlete: ${row.athlete_uuid}  |  Date: ${row.session_date?.toISOString().split("T")[0]}`);
  console.log(`Total keys in metrics JSON: ${allKeys.length}\n`);

  for (const pattern of PATTERNS) {
    const matches = allKeys.filter((k) => k.startsWith(pattern));
    console.log(`Pattern: "${pattern}"`);
    if (matches.length === 0) {
      console.log("  ⚠ NO MATCHES FOUND");
    } else {
      for (const key of matches) {
        const val = metrics[key];
        const display = Array.isArray(val) ? val[0] : val;
        console.log(`  ${key}  ->  ${display}`);
      }
    }
    console.log();
  }

  await prisma.$disconnect();
}

main().catch(console.error);
