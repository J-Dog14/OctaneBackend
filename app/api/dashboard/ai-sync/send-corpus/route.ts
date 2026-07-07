import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/requireAuth";
import { countCorpusAthletes, sendCorpusBatch } from "@/lib/octane/aiLayerSync";
import { internalError, success } from "@/lib/responses";

/**
 * Push one batch of the AI corpus (all athletes' profiles + prescription
 * history) to Octane. The client loops with the returned cursor until
 * nextCursor is null. Body: { cursor?: string|null, batchSize?: number }
 */
export async function POST(request: NextRequest) {
  await requireRole("admin");
  try {
    const body = (await request.json().catch(() => ({}))) as {
      cursor?: string | null;
      batchSize?: number;
    };
    const batchSize = Math.min(Math.max(body.batchSize ?? 10, 1), 50);

    const [result, total] = await Promise.all([
      sendCorpusBatch({ cursor: body.cursor ?? null, batchSize }),
      countCorpusAthletes(),
    ]);

    return success({ ...result, total });
  } catch (err) {
    console.error("ai-sync send-corpus failed:", err);
    return internalError(err instanceof Error ? err.message : "Unknown error");
  }
}
