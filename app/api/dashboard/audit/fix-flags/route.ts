import { requireAuth } from "@/lib/auth/requireAuth";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { internalError, success } from "@/lib/responses";

export async function POST() {
  await requireAuth();
  try {
    await prisma.$executeRawUnsafe("SELECT update_athlete_data_flags()");

    try {
      await prisma.auditLog.create({
        data: {
          duration_ms: 0,
          triggered_by: "fix-flags",
          critical_count: 0,
          warning_count: 0,
          info_count: 0,
          report_json: { action: "fix-flags" } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (logErr) {
      console.error("Failed to write audit log for fix-flags:", logErr);
    }

    return success({ ok: true, message: "Athlete flags and session counts recalculated." });
  } catch (error) {
    console.error("Error in POST /api/dashboard/audit/fix-flags:", error);
    return internalError("Failed to recalculate athlete flags");
  }
}
