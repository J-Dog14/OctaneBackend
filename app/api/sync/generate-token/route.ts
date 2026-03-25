import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/requireAuth";

/**
 * POST /api/sync/generate-token
 * Generates a new agent token and saves it to org settings.
 * Invalidates any previously issued token immediately.
 */
export async function POST() {
  await requireRole("admin");

  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

  await prisma.orgSetting.upsert({
    where: { key: "agent_token" },
    create: { key: "agent_token", value: token },
    update: { value: token },
  });

  // Reset last-seen so agent shows as offline until it reconnects with new token
  await prisma.orgSetting.deleteMany({ where: { key: "agent_last_seen" } });

  return NextResponse.json({ token });
}
