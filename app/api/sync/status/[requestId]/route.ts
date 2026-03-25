import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/requireAuth";

/**
 * GET /api/sync/status/[requestId]
 * Browser polls this while waiting for the agent to upload files.
 * Returns: { status: "pending" | "fulfilled" | "error", fileKeys?: string[], errorMsg?: string }
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  await requireRole("admin");
  const { requestId } = await params;

  const syncRequest = await prisma.syncRequest.findUnique({ where: { id: requestId } });
  if (!syncRequest) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (new Date() > syncRequest.expiresAt && syncRequest.status === "pending") {
    return NextResponse.json({ status: "error", errorMsg: "Request expired — agent did not respond in time." });
  }

  return NextResponse.json({
    status: syncRequest.status,
    fileKeys: syncRequest.fileKeys,
    errorMsg: syncRequest.errorMsg,
  });
}
