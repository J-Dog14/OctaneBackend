import { prisma } from "../lib/db/prisma";
async function main() {
  const row = await prisma.f_hitting_trials.findFirst({
    orderBy: { session_date: "desc" },
    select: { metrics: true },
  });
  const metrics = row?.metrics as Record<string, unknown>;
  const allKeys = Object.keys(metrics).sort();

  console.log("=== knee_height / max_knee ===");
  const kneeHeight = allKeys.filter(k => k.toLowerCase().includes("knee_height") || k.toLowerCase().includes("max_knee"));
  if (kneeHeight.length === 0) console.log("  NO MATCHES");
  else kneeHeight.forEach(k => console.log(`  ${k}  ->  ${Array.isArray(metrics[k]) ? metrics[k][0] : metrics[k]}`));

  console.log("\n=== Trunk_Angle keys (all) ===");
  allKeys.filter(k => k.includes("Trunk_Angle")).forEach(k =>
    console.log(`  ${k}  ->  ${Array.isArray(metrics[k]) ? metrics[k][0] : metrics[k]}`)
  );

  console.log("\n=== Pelvis_Angle keys (all) ===");
  allKeys.filter(k => k.includes("Pelvis_Angle")).forEach(k =>
    console.log(`  ${k}  ->  ${Array.isArray(metrics[k]) ? metrics[k][0] : metrics[k]}`)
  );

  await prisma.$disconnect();
}
main().catch(console.error);
