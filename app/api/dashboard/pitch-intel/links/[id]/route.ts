import { NextRequest } from "next/server";
import { z } from "zod";
import { badRequest, internalError, notFound, success } from "@/lib/responses";
import { apiErrorMessage } from "@/lib/pitch-intel/errors";
import { requireRole } from "@/lib/auth/requireAuth";
import { getLink, setPullEnabled } from "@/lib/pitch-intel/db";

export const dynamic = "force-dynamic";

const patchSchema = z.object({ pullEnabled: z.boolean() });

/**
 * PATCH /api/dashboard/pitch-intel/links/:id (admin)
 * Pauses or resumes nightly pulls. Pausing keeps the stored pitches.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin");
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return badRequest("Invalid link id");
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return badRequest("Body must be { pullEnabled: boolean }");
    if (!(await getLink(id))) return notFound("Link not found");
    await setPullEnabled(id, parsed.data.pullEnabled);
    return success({ link: await getLink(id) });
  } catch (error) {
    console.error("Error in PATCH /api/dashboard/pitch-intel/links/[id]:", error);
    return internalError(apiErrorMessage(error, "Failed to update link"));
  }
}
