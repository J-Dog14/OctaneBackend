import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

/**
 * POST /api/sync/complete
 * Called by the OctaneSync agent after uploading files to R2.
 * Body: { requestId: string, fileKeys: string[] }
 *    or { requestId: string, error: string } on failure
 * Auth: Authorization: Bearer <agent_token>
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agentTokenRow = await prisma.orgSetting.findUnique({ where: { key: "agent_token" } });
  if (!agentTokenRow || agentTokenRow.value !== token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as { requestId?: string; fileKeys?: string[]; error?: string };
  const { requestId, fileKeys, error } = body;

  if (!requestId) return NextResponse.json({ error: "requestId required" }, { status: 400 });

  const existing = await prisma.syncRequest.findUnique({ where: { id: requestId } });
  if (!existing) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  if (error) {
    await prisma.syncRequest.update({
      where: { id: requestId },
      data: { status: "error", errorMsg: error },
    });
    return NextResponse.json({ ok: true });
  }

  await prisma.syncRequest.update({
    where: { id: requestId },
    data: { status: "fulfilled", fileKeys: fileKeys ?? [] },
  });

  return NextResponse.json({ ok: true });
}
