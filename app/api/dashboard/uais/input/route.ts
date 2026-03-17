import { NextRequest } from "next/server";
import { badRequest, success } from "@/lib/responses";
import { writeInput } from "@/lib/uais/runJob";
import { requireAuth } from "@/lib/auth/requireAuth";

/**
 * POST /api/dashboard/uais/input
 * Body: { jobId: string, input: string }
 * Sends input to the running process's stdin (e.g. for conflict prompts).
 * Returns 200 with { ok: false, error } when job not found or already finished (so UI can show a friendly message).
 */
export async function POST(request: NextRequest) {
  await requireAuth();
  try {
    let body: { jobId?: string; input?: string };
    try {
      body = await request.json();
    } catch {
      return badRequest("JSON body required");
    }
    const { jobId, input } = body;
    if (!jobId || typeof jobId !== "string") {
      return badRequest("jobId is required");
    }
    if (typeof input !== "string") {
      return badRequest("input is required");
    }
    const ok = writeInput(jobId, input.endsWith("\n") ? input : input + "\n");
    if (!ok) {
      return success({
        ok: false,
        error: "Job not found or already finished. The process may have completed before your response was sent.",
      });
    }
    return success({ ok: true });
  } catch {
    return badRequest("Invalid request");
  }
}
