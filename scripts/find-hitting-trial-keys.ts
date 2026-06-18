/**
 * Finds all hitting payload metric keys in f_hitting_trials metrics JSON.
 * Run: npx tsx scripts/find-hitting-trial-keys.ts
 */
import { prisma } from "../lib/db/prisma";

// All metricNameCandidates from hittingPayload.ts (first candidate per spec)
const PATTERNS = [
  "PROCESSED.Max_Pelvis_Ang_Vel",
  "PROCESSED.Max_Thorax_Ang_Vel",
  "PROCESSED.Max_Lead_Forearm_Ang_Vel",
  "PROCESSED.Max_Lead_Hand_Ang_Vel",
  "PROCESSED.Max_Bat_Ang_Vel",
  "PLANE.Horizontal_attack_angle",
  "PLANE.Vertical_attack_angle",
  "PROCESSED.Max_RPV_CGPos_VLab_Linear_Vel",
  "PROCESSED.Max_RTA_CGPos_VLab_Linear_Vel",
  "PROCESSED.Bat_travelled_distance_max",
  "PLANE.Bat_Angle_Frontal@Contact",
  "PLANE.Bat_Angle_Sagittal@Contact",
  "PLANE.Bat_Angle_Transversal@Contact",
  "PROCESSED.Lead_Knee_Angle@Contact",
  "PROCESSED.Lead_Knee_Angle@Lead_Foot_Down",
  "PROCESSED.Pelvis_Angle@Lead_Foot_Down",
  "PROCESSED.Pelvis_Angle@Contact",
  "PROCESSED.Pelvis_Shoulders_Separation@Setup",
  "PROCESSED.Pelvis_Shoulders_Separation@Lead_Foot_Down",
  "PROCESSED.Pelvis_Shoulders_Separation@Downswing",
  "PROCESSED.Pelvis_Shoulders_Separation@Max_Bat_Ang_Vel",
  "PROCESSED.Pelvis_Shoulders_Separation@Max_Lead_Hand_Ang_Vel",
  "PROCESSED.Pelvis_Shoulders_Separation@Contact",
  "PROCESSED.Trunk_Angle@Lead_Foot_Down",
  "PROCESSED.Trunk_Angle@Contact",
  "PROCESSED.Stride_Width@Lead_Foot_Down",
];

async function main() {
  const row = await prisma.f_hitting_trials.findFirst({
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
