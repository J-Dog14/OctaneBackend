import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/requireAuth";

/**
 * GET /api/sync/agent-status
 * Browser polls this to show whether the OctaneSync agent is connected.
 * Agent is considered "online" if it polled within the last 15 seconds.
 */
export async function GET() {
  await requireRole("admin");

  const row = await prisma.orgSetting.findUnique({ where: { key: "agent_last_seen" } });
  if (!row) return NextResponse.json({ online: false });

  const lastSeen = new Date(row.value);
  const online = Date.now() - lastSeen.getTime() < 15_000;

  return NextResponse.json({ online, lastSeen: row.value });
}
