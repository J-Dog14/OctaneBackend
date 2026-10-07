import { NextRequest } from "next/server";
import { z } from "zod";
import { badRequest, internalError, notFound, success } from "@/lib/responses";
import { apiErrorMessage } from "@/lib/pitch-intel/errors";
import { requireRole } from "@/lib/auth/requireAuth";
import { getLink } from "@/lib/pitch-intel/db";
import { pullRange } from "@/lib/pitch-intel/pull";
import { minDate, todayET } from "@/lib/pitch-intel/dates";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ season: z.number().int().min(2008).max(2100).optional() });

/**
 * POST /api/dashboard/pitch-intel/links/:id/pull (admin)
 * "Pull now": re-pulls one season (default: the current one) and waits for the result.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin");
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return badRequest("Invalid link id");
    const parsed = bodySchema.safeParse((await request.json().catch(() => ({}))) ?? {});
    if (!parsed.success) return badRequest("Body must be { season?: number }");

    const link = await getLink(id);
    if (!link) return notFound("Link not found");

    const today = todayET();
    const season = parsed.data.season ?? Number(today.slice(0, 4));
    const result = await pullRange(link, `${season}-01-01`, minDate(`${season}-12-31`, today), "ui");
    return success({ result });
  } catch (error) {
    console.error("Error in POST /api/dashboard/pitch-intel/links/[id]/pull:", error);
    return internalError(apiErrorMessage(error, "Pull failed"));
  }
}
