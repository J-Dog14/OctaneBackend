// Next.js instrumentation hook — runs once per server process startup.
// We eagerly connect Prisma here so the Neon connection is warm before
// the first request arrives, instead of paying that latency on request 1.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { prisma } = await import("@/lib/db/prisma");
    await prisma.$connect();

    // Warm athlete-tracking population caches in the background.
    // This avoids the cold-start penalty (150 athletes × 6 domains) on the
    // first real request after a deploy or Railway restart.
    void import("@/lib/athlete-tracking/percentiles").then(({ warmPopulationCaches }) => {
      warmPopulationCaches().catch(() => {
        // Silently swallow — caches will fill on the first real request instead.
      });
    });
  }
}
