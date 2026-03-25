import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/requireAuth";

/**
 * POST /api/sync/request
 * Called by the browser when the user clicks Run and the agent is online.
 * Creates a pending SyncRequest that the agent will pick up and fulfill.
 * Body: { runnerId: string, athleteUuid?: string, reportOnly?: boolean, dataPath?: string }
 * Returns: { requestId: string }
 */
export async function POST(request: NextRequest) {
  await requireRole("admin");

  const body = await request.json() as { runnerId?: string; athleteUuid?: string; reportOnly?: boolean; dataPath?: string };
  const { runnerId, athleteUuid, reportOnly, dataPath } = body;

  if (!runnerId) return NextResponse.json({ error: "runnerId required" }, { status: 400 });

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minute TTL

  const syncRequest = await prisma.syncRequest.create({
    data: {
      runnerId,
      athleteUuid: athleteUuid ?? null,
      reportOnly: reportOnly ?? false,
      dataPath: dataPath?.trim() || null,
      expiresAt,
    },
  });

  return NextResponse.json({ requestId: syncRequest.id });
}
