import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/requireAuth";
import { killJob } from "@/lib/uais/runJob";

/**
 * POST /api/dashboard/uais/kill
 * Sends SIGTERM to a running UAIS job.
 * Body: { jobId: string }
 */
export async function POST(request: NextRequest) {
  await requireRole("admin");
  const { jobId } = await request.json() as { jobId?: string };
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });
  const killed = killJob(jobId);
  return NextResponse.json({ ok: killed });
}
