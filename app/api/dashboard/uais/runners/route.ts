import { NextResponse } from "next/server";
import { getUaisRunnersInCanonicalOrder } from "@/lib/uais/runners";
import { requireAuth } from "@/lib/auth/requireAuth";

/**
 * GET /api/dashboard/uais/runners
 * Returns list of UAIS runners in canonical order (Athletic Screen first, etc.).
 */
export async function GET() {
  await requireAuth();
  const runners = getUaisRunnersInCanonicalOrder();
  return NextResponse.json({ runners });
}
