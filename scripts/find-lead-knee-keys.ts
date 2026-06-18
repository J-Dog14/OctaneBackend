import { prisma } from "../lib/db/prisma";
async function main() {
  const row = await prisma.f_hitting_trials.findFirst({
    orderBy: { session_date: "desc" },
    select: { metrics: true, athlete_uuid: true, session_date: true },
  });
  const metrics = row?.metrics as Record<string, unknown>;
  const allKeys = Object.keys(metrics).sort();
  const matches = allKeys.filter(k => k.toLowerCase().includes("lead_knee"));
  console.log(`Total keys: ${allKeys.length}  |  Lead_Knee matches: ${matches.length}\n`);
  matches.forEach(k => {
    const val = metrics[k];
    console.log(`${k}  ->  ${Array.isArray(val) ? val[0] : val}`);
  });
  await prisma.$disconnect();
}
main().catch(console.error);
