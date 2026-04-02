import { PrismaClient } from "@prisma/client";

/**
 * Unpooled Prisma client for UAIS sync operations.
 * Uses DATABASE_URL_DIRECT (no PgBouncer) to avoid timeouts on
 * long-running transactions during UAIS maintenance syncs.
 * Only use this in /api/uais/* routes.
 */
const globalForPrismaDirect = globalThis as unknown as {
  prismaDirect: PrismaClient | undefined;
};

export const prismaDirect =
  globalForPrismaDirect.prismaDirect ??
  new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL_DIRECT,
    log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrismaDirect.prismaDirect = prismaDirect;
}
