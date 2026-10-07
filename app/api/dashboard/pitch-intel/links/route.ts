import { NextRequest } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { badRequest, internalError, success } from "@/lib/responses";
import { apiErrorMessage } from "@/lib/pitch-intel/errors";
import { requireAuth, requireRole } from "@/lib/auth/requireAuth";
import { listLinks } from "@/lib/pitch-intel/db";
import { createLink, LinkError } from "@/lib/pitch-intel/links";
import { backfill } from "@/lib/pitch-intel/pull";

export const dynamic = "force-dynamic";

/** GET /api/dashboard/pitch-intel/links — linked athletes with pitch counts and last pull status. */
export async function GET() {
  await requireAuth();
  try {
    return success({ links: await listLinks() });
  } catch (error) {
    console.error("Error in GET /api/dashboard/pitch-intel/links:", error);
    return internalError(apiErrorMessage(error, "Failed to load linked athletes"));
  }
}

const createSchema = z.object({
  athleteUuid: z.string().min(1).max(36),
  player: z.object({
    id: z.string().regex(/^\d{4,8}$/, "Savant player ID must be a number"),
    name: z.string().min(1),
    throws: z.enum(["L", "R"]).nullable(),
    league: z.string().nullable(),
    isMlb: z.boolean(),
  }),
  backfillFrom: z.number().int().min(2008).max(2100).optional(),
});

/**
 * POST /api/dashboard/pitch-intel/links (admin)
 * Step 3 of linking: saves the link, then starts the backfill in the background.
 * Progress shows up in /api/dashboard/pitch-intel/runs.
 */
export async function POST(request: NextRequest) {
  await requireRole("admin");
  try {
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues.map((e) => e.message).join(", "));

    let linkedBy: string | null = null;
    if (process.env.CLERK_SECRET_KEY) {
      const user = await currentUser();
      linkedBy = user?.primaryEmailAddress?.emailAddress ?? user?.id ?? null;
    }

    const link = await createLink({ ...parsed.data, linkedBy });

    void backfill(link, link.backfill_from ?? new Date().getFullYear(), "backfill").catch((err) =>
      console.error(`[pitch-intel] backfill failed for link ${link.id}:`, err),
    );

    return success({ link, backfillStarted: true }, 201);
  } catch (error) {
    if (error instanceof LinkError) return badRequest(error.message);
    console.error("Error in POST /api/dashboard/pitch-intel/links:", error);
    return internalError(apiErrorMessage(error, "Failed to link athlete"));
  }
}
