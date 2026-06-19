import { prisma } from "./lib/db/prisma";

async function main() {
  const row = await prisma.f_pitching_trials.findFirst({
    orderBy: { session_date: "desc" },
    select: { metrics: true },
  });
  
  if (!row) {
    console.log("No pitching trials found");
    await prisma.$disconnect();
    return;
  }

  const metrics = row?.metrics as Record<string, unknown>;
  const timingKeys = Object.keys(metrics)
    .filter(k => k.startsWith("TIMING."))
    .sort();
  
  console.log(`Found ${timingKeys.length} TIMING.* keys:\n`);
  timingKeys.forEach(k => {
    const val = metrics[k];
    const display = Array.isArray(val) ? val[0] : val;
    console.log(`${k} -> ${display}`);
  });
  
  await prisma.$disconnect();
}

main().catch(console.error);
