import { requireAuth } from "@/lib/auth/requireAuth";
import { prisma } from "@/lib/db/prisma";
import { internalError, success } from "@/lib/responses";

export async function GET() {
  await requireAuth();
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { run_at: "desc" },
      take: 20,
      select: {
        id: true,
        run_at: true,
        duration_ms: true,
        triggered_by: true,
        critical_count: true,
        warning_count: true,
        info_count: true,
      },
    });
    return success(logs);
  } catch (error) {
    console.error("Error in GET /api/dashboard/audit/history:", error);
    return internalError("Failed to fetch audit history");
  }
}
