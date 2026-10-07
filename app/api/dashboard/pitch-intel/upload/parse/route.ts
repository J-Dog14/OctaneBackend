import { NextRequest } from "next/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { requireRole } from "@/lib/auth/requireAuth";
import { previewUpload, UploadError } from "@/lib/pitch-intel/uploads/handle";
import { apiErrorMessage } from "@/lib/pitch-intel/errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/dashboard/pitch-intel/upload/parse (admin), multipart field "file".
 * Reads a Trackman/Savant spreadsheet or a screenshot and returns a preview to
 * review. Nothing is saved.
 */
export async function POST(request: NextRequest) {
  await requireRole("admin");
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return badRequest("Attach a file");
    const bytes = Buffer.from(await file.arrayBuffer());
    return success(await previewUpload(file.name, file.type || null, bytes));
  } catch (error) {
    if (error instanceof UploadError) return badRequest(error.message);
    console.error("Error in POST /api/dashboard/pitch-intel/upload/parse:", error);
    const message = error instanceof Error && /Trackman|Screenshot|xlsx|workbook|zip/i.test(error.message) ? error.message : apiErrorMessage(error, "Couldn't read that file");
    return internalError(message);
  }
}
