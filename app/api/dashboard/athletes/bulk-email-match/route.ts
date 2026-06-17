import { NextRequest } from "next/server";
import { internalError, success } from "@/lib/responses";
import { prisma } from "@/lib/db/prisma";
import { lookupOctaneUserByEmail } from "@/lib/octane/octaneUserLookup";
import { requireRole } from "@/lib/auth/requireAuth";

export async function POST(request: NextRequest) {
  await requireRole("admin");

  const body = await request.json().catch(() => ({})) as { forceRefresh?: boolean };
  const forceRefresh = body.forceRefresh === true;

  try {
    const [athletes, alreadyLinked] = await Promise.all([
      prisma.d_athletes.findMany({
        where: {
          email: { not: null },
          ...(forceRefresh ? {} : { app_db_uuid: null }),
        },
        select: { athlete_uuid: true, name: true, email: true },
      }),
      forceRefresh
        ? Promise.resolve(0)
        : prisma.d_athletes.count({
            where: { email: { not: null }, app_db_uuid: { not: null } },
          }),
    ]);

    let matched = 0;
    let notFound = 0;
    let errors = 0;
    const errorDetails: { name: string; email: string; error: string }[] = [];

    for (const athlete of athletes) {
      if (!athlete.email) continue;

      const result = await lookupOctaneUserByEmail(athlete.email);

      if (result.ok) {
        await prisma.d_athletes.update({
          where: { athlete_uuid: athlete.athlete_uuid },
          data: { app_db_uuid: result.user.uuid, app_db_synced_at: new Date() },
        });
        matched++;
      } else if (result.status === 404) {
        notFound++;
      } else {
        errors++;
        errorDetails.push({
          name: athlete.name ?? athlete.athlete_uuid,
          email: athlete.email,
          error: result.error,
        });
      }
    }

    return success({
      total: athletes.length + alreadyLinked,
      checked: athletes.length,
      matched,
      alreadyLinked,
      notFound,
      errors,
      ...(errorDetails.length > 0 ? { errorDetails } : {}),
    });
  } catch (error) {
    console.error("Error in POST /api/dashboard/athletes/bulk-email-match:", error);
    return internalError("Bulk email match failed");
  }
}
