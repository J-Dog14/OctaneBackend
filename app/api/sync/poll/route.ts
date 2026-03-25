import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

/**
 * GET /api/sync/poll
 * Called by the OctaneSync agent every 3 seconds.
 * Returns the oldest pending SyncRequest, if any.
 * Also updates agent_last_seen so the dashboard can show agent status.
 * Auth: Authorization: Bearer <agent_token>
 */
export async function GET(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agentTokenRow = await prisma.orgSetting.findUnique({ where: { key: "agent_token" } });
  if (!agentTokenRow || agentTokenRow.value !== token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Update last-seen heartbeat
  await prisma.orgSetting.upsert({
    where: { key: "agent_last_seen" },
    create: { key: "agent_last_seen", value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });

  // Clean up expired requests
  await prisma.syncRequest.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });

  // Return the oldest pending request
  const pending = await prisma.syncRequest.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ request: pending ?? null });
}
