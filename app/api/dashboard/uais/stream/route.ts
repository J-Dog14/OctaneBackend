import { NextRequest } from "next/server";
import { notFound } from "@/lib/responses";
import { getJob, attachStreamController } from "@/lib/uais/runJob";
import { requireAuth } from "@/lib/auth/requireAuth";

/**
 * GET /api/dashboard/uais/stream?jobId=...
 * Streams stdout/stderr from the UAIS process. Call after POST /api/dashboard/uais/run.
 */
export async function GET(request: NextRequest) {
  await requireAuth();
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");
  if (!jobId) {
    return notFound("jobId required");
  }
  const job = getJob(jobId);
  if (!job) {
    return notFound("Job not found or already finished");
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      attachStreamController(jobId, controller);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}
