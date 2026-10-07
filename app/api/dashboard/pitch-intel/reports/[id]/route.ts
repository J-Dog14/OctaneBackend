import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { requireRole } from "@/lib/auth/requireAuth";
import { deleteReport } from "@/lib/pitch-intel/reports/save";

export const dynamic = "force-dynamic";

/** DELETE /api/dashboard/pitch-intel/reports/:id (admin) — removes a saved screenshot report. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin");
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return badRequest("Invalid report id");
    await deleteReport(id);
    return success({ deleted: id });
  } catch (error) {
    console.error("Error in DELETE /api/dashboard/pitch-intel/reports/[id]:", error);
    return internalError("Failed to delete report");
  }
}
