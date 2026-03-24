import { NextResponse } from "next/server";
import { getUaisRunnersInCanonicalOrder, getRunnersFromSettings } from "@/lib/uais/runners";
import { requireRole } from "@/lib/auth/requireAuth";
import { prisma } from "@/lib/db/prisma";

/**
 * GET /api/dashboard/uais/runners
 * Returns list of UAIS runners in canonical order (Athletic Screen first, etc.).
 * Priority: config file → UAIS_ROOT env → individual CWD env vars → org Settings (DB).
 * The Settings fallback lets admins enable runners purely from the Settings UI,
 * with no env vars or config files required.
 */
export async function GET() {
  await requireRole("admin");

  let runners = getUaisRunnersInCanonicalOrder();

  // If no runners found via file/env, fall back to DB settings.
  if (runners.length === 0) {
    try {
      const rows = await prisma.orgSetting.findMany();
      const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      runners = getRunnersFromSettings(settings);
    } catch {
      // Non-fatal: return empty list
    }
  }

  return NextResponse.json({ runners });
}
