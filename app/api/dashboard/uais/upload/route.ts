import { NextRequest, NextResponse } from "next/server";
import { uploadToR2, deleteFromR2 } from "@/lib/r2/upload";

const MAX_FILE_SIZE_MB = 100;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/**
 * POST /api/dashboard/uais/upload
 * Accepts a multipart/form-data file upload and stores it in R2.
 * Fields: file (required), assessmentType (required)
 * Returns: { key, filename, size }
 */
export async function POST(request: NextRequest) {
  if (!process.env.R2_ACCOUNT_ID) {
    return NextResponse.json(
      { error: "Cloud storage not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME." },
      { status: 503 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const file = formData.get("file");
  const assessmentType = formData.get("assessmentType");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  if (!assessmentType || typeof assessmentType !== "string") {
    return NextResponse.json({ error: "Missing 'assessmentType' field" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `File too large. Maximum ${MAX_FILE_SIZE_MB}MB.` },
      { status: 413 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";

  try {
    const key = await uploadToR2(buffer, file.name, assessmentType.trim(), contentType);
    return NextResponse.json({ key, filename: file.name, size: file.size });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/dashboard/uais/upload?key=...
 * Removes a previously uploaded file from R2.
 */
export async function DELETE(request: NextRequest) {
  const key = new URL(request.url).searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing 'key' query param" }, { status: 400 });
  }

  try {
    await deleteFromR2(key);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
