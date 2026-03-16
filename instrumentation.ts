// Next.js instrumentation hook — runs once per server process startup.
// We eagerly connect Prisma here so the Neon connection is warm before
// the first request arrives, instead of paying that latency on request 1.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { prisma } = await import("@/lib/db/prisma");
    await prisma.$connect();
  }
}
