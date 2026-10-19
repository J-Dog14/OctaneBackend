import { NextRequest } from "next/server";
import { badRequest, internalError, notFound, success } from "@/lib/responses";
import { requireCoachForAthlete } from "@/lib/coach/access";
import { buildExport, ExportSelectionError, getExportListing, parseSelection } from "@/lib/coach/export";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/coach/athletes/:uuid/export — every data type and session date this athlete has, for the download page. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  try {
    const listing = await getExportListing(uuid);
    return listing ? success(listing) : notFound("Athlete not found");
  } catch (error) {
    console.error("Error in GET /api/coach/athletes/[uuid]/export:", error);
    return internalError("Failed to list this athlete's data");
  }
}

/**
 * POST /api/coach/athletes/:uuid/export — ZIP of CSVs.
 * Body: { all?: true, categories?: { trackman: ["2026-10-18", ...] | "all", ... }, raw?: boolean }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const denied = await requireCoachForAthlete(uuid);
  if (denied) return denied;
  let selection;
  try {
    selection = parseSelection(await request.json().catch(() => null));
  } catch (error) {
    return badRequest(error instanceof ExportSelectionError ? error.message : "Bad request");
  }
  try {
    const out = await buildExport(uuid, selection);
    if (!out) return notFound("Athlete not found");
    if (!out.files) return badRequest("No data matched that selection");
    console.info(`[coach-export] ${uuid}: ${out.files} files, ${out.zip.length} bytes${selection.all ? " (all)" : ""}${selection.raw ? " +raw" : ""}`);
    return new Response(new Uint8Array(out.zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${out.filename}"`,
        "Content-Length": String(out.zip.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Error in POST /api/coach/athletes/[uuid]/export:", error);
    return internalError(error instanceof Error && /too large|Too many/.test(error.message) ? error.message : "Failed to build the download");
  }
}
