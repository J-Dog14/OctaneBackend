import { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { requireRole } from "@/lib/auth/requireAuth";
import { getAiLabConfig } from "@/lib/ai-lab/config";
import { badRequest, notFound } from "@/lib/responses";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/**
 * GET /api/dashboard/ai-lab/file?path=<relative to OctaneAiLayer/outputs>[&download=1]
 * Serves AI-layer outputs (coach reports, packets, PDFs) to the page. Only
 * files inside outputs/ with a known type are served; the resolved real path
 * must stay inside outputs/ so neither "..", absolute paths nor symlinks can
 * reach anything else (.env lives one level up).
 */
export async function GET(request: NextRequest) {
  await requireRole("admin");
  const url = new URL(request.url);
  const rel = url.searchParams.get("path") ?? "";
  if (!rel || rel.includes("\0") || path.isAbsolute(rel)) return badRequest("relative path required");

  const cfg = await getAiLabConfig();
  if (!cfg.outputsDir) return notFound("AI layer not configured");
  const ext = path.extname(rel).toLowerCase();
  const type = TYPES[ext];
  if (!type) return badRequest("file type not served");

  let full: string;
  let root: string;
  try {
    root = await realpath(cfg.outputsDir);
    full = await realpath(path.resolve(cfg.outputsDir, rel));
  } catch {
    return notFound("file not found");
  }
  const inside = full.toLowerCase().startsWith((root + path.sep).toLowerCase());
  if (!inside) return badRequest("path escapes outputs/");
  const st = await stat(full).catch(() => null);
  if (!st?.isFile()) return notFound("file not found");

  const download = url.searchParams.get("download") === "1" || ext === ".zip" || ext === ".docx";
  const name = path.basename(full).replace(/"/g, "");
  const body = Readable.toWeb(createReadStream(full)) as unknown as ReadableStream;
  // Reports run their own scripts (Plotly). Sandbox them into an opaque
  // origin so a report can never call this dashboard's APIs as the admin.
  const sandbox: Record<string, string> =
    ext === ".html" ? { "Content-Security-Policy": "sandbox allow-scripts allow-popups allow-modals" } : {};
  return new Response(body, {
    headers: {
      ...sandbox,
      "Content-Type": type,
      "Content-Length": String(st.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
