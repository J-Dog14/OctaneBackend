import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireAuth";
import { handleLegacyAction } from "@/lib/pitch-intel/legacy/adapter";
import { apiErrorMessage } from "@/lib/pitch-intel/errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/dashboard/pitch-intel/legacy?action=<getAthletes|getOutings|scoreArsenal|analyze>
 * Backend for Ryan's dashboard (public/pitch-intel-app/), same protocol as his
 * Apps Script: text/plain JSON body in, JSON out, errors as { error } with 200.
 */
export async function POST(request: NextRequest) {
  await requireAuth();
  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" });
  }
  const action = new URL(request.url).searchParams.get("action") ?? (typeof body.action === "string" ? body.action : undefined);
  try {
    return NextResponse.json(await handleLegacyAction(action, body));
  } catch (error) {
    console.error(`Error in POST /api/dashboard/pitch-intel/legacy (${action}):`, error);
    return NextResponse.json({ error: apiErrorMessage(error, "Failed to load Pitch Intelligence data") });
  }
}
