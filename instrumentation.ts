// Next.js instrumentation hook — runs once per server process startup.
// We eagerly connect Prisma here so the Neon connection is warm before
// the first request arrives, instead of paying that latency on request 1.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { prisma } = await import("@/lib/db/prisma");
    await prisma.$connect();

    // Warm athlete-tracking population caches in the background.
    void import("@/lib/athlete-tracking/percentiles").then(({ warmPopulationCaches }) => {
      warmPopulationCaches().catch(() => {
        // Silently swallow — caches will fill on the first real request instead.
      });
    });

    // Generate uais/config/db_connections.yaml from org settings / env vars.
    // The UAIS Python scripts require this file to exist before they check
    // the WAREHOUSE_DATABASE_URL env var, so we write it at startup.
    void generateDbConnectionsYaml(prisma);
  }
}

async function generateDbConnectionsYaml(prisma: import("@prisma/client").PrismaClient) {
  try {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const path = await import("node:path");

    // Resolve warehouse DB URL: org settings first, then env var
    let warehouseUrl = process.env.WAREHOUSE_DATABASE_URL ?? "";
    try {
      const row = await prisma.orgSetting.findUnique({ where: { key: "uais_warehouse_db_url" } });
      if (row?.value?.trim()) warehouseUrl = row.value.trim();
    } catch { /* non-fatal */ }

    if (!warehouseUrl) return; // Nothing to write — scripts will fail naturally with a clear error

    const appUrl = process.env.DATABASE_URL ?? "";
    const configDir = path.join(process.cwd(), "uais", "config");
    const configPath = path.join(configDir, "db_connections.yaml");

    const yaml = [
      "# Auto-generated at startup from org settings. Do not edit manually.",
      "databases:",
      "  app:",
      "    postgres:",
      `      connection_string: "${appUrl}"`,
      "  warehouse:",
      "    postgres:",
      `      connection_string: "${warehouseUrl}"`,
    ].join("\n") + "\n";

    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, yaml, "utf8");
  } catch {
    // Non-fatal — scripts will fall back to WAREHOUSE_DATABASE_URL env var
  }
}
