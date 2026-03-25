import { NextResponse } from "next/server";
import { getUaisRunnersInCanonicalOrder, getRunnersFromSettings } from "@/lib/uais/runners";
import { requireRole } from "@/lib/auth/requireAuth";
import { prisma } from "@/lib/db/prisma";

/**
 * GET /api/dashboard/uais/runners
 * Returns list of UAIS runners in canonical order (Athletic Screen first, etc.).
 * Priority: org Settings (DB) → config file → UAIS_ROOT env → individual CWD env vars.
 * Settings is priority 1 so admins can manage runners entirely from the UI.
 */
export async function GET() {
  await requireRole("admin");

  // Priority 1: DB Settings — admins control everything from the Settings UI.
  try {
    const rows = await prisma.orgSetting.findMany();
    const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const settingsRunners = getRunnersFromSettings(settings);
    if (settingsRunners.length > 0) {
      // Also return the configured data dirs so the frontend can pre-fill per-run path inputs
      const dataDirs = Object.fromEntries(
        settingsRunners.map((r) => {
          const key = `uais_data_dir_${r.id.replace(/-/g, "_")}`;
          return [r.id, settings[key]?.trim() ?? ""];
        })
      );
      return NextResponse.json({ runners: settingsRunners, dataDirs });
    }
  } catch {
    // Non-fatal: fall through to env/config
  }

  // Priority 2: config file / env vars (local dev or self-hosted without DB config)
  const runners = getUaisRunnersInCanonicalOrder();
  return NextResponse.json({ runners, dataDirs: {} });
}
