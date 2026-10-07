import { NextRequest } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { badRequest, internalError, success } from "@/lib/responses";
import { requireRole } from "@/lib/auth/requireAuth";
import { commitUpload, UploadError, type CommitPayload } from "@/lib/pitch-intel/uploads/handle";
import { apiErrorMessage } from "@/lib/pitch-intel/errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/dashboard/pitch-intel/upload/commit (admin)
 * multipart: "payload" (JSON: the reviewer's choices) + "file" (spreadsheets
 * are re-read here so the saved numbers always come from the file) + "filename".
 */
export async function POST(request: NextRequest) {
  await requireRole("admin");
  try {
    const form = await request.formData();
    const rawPayload = form.get("payload");
    if (typeof rawPayload !== "string") return badRequest("Missing payload");
    const payload = JSON.parse(rawPayload) as CommitPayload;
    if (!payload || !["trackman", "savant", "screenshot"].includes(payload.kind)) return badRequest("Unknown upload kind");
    const file = form.get("file");
    const bytes = file instanceof File ? Buffer.from(await file.arrayBuffer()) : null;
    const filename = file instanceof File ? file.name : String(form.get("filename") ?? "upload");

    let uploadedBy: string | null = null;
    if (process.env.CLERK_SECRET_KEY) {
      const user = await currentUser();
      uploadedBy = user?.primaryEmailAddress?.emailAddress ?? user?.id ?? null;
    }
    return success(await commitUpload(filename, bytes, payload, uploadedBy));
  } catch (error) {
    if (error instanceof UploadError) return badRequest(error.message);
    console.error("Error in POST /api/dashboard/pitch-intel/upload/commit:", error);
    const message = error instanceof Error && /already linked|doesn't exist|isn't linked|more than one pitcher|at least one pitch/i.test(error.message)
      ? error.message
      : apiErrorMessage(error, "Couldn't save that upload");
    return internalError(message);
  }
}
