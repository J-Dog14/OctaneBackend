import { parseCsv, type ParsedCsv } from "../csv";
import { parseXlsx } from "./xlsx";

export type UploadKind = "savant" | "trackman" | "screenshot";

export const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);

/** Reads a spreadsheet upload (.csv or .xlsx) into string rows. */
export function readSpreadsheet(filename: string, bytes: Buffer): ParsedCsv {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || (bytes[0] === 0x50 && bytes[1] === 0x4b)) return parseXlsx(bytes);
  if (lower.endsWith(".xls")) throw new Error("Old .xls workbooks aren't supported. Save it as .xlsx or .csv and upload again.");
  return parseCsv(bytes.toString("utf8"));
}

/** Savant vs Trackman from the header row. */
export function detectSpreadsheet(headers: string[]): "savant" | "trackman" | null {
  const h = new Set(headers.map((x) => x.trim().toLowerCase()));
  if (h.has("pitch_type") && h.has("release_speed")) return "savant";
  if (h.has("relspeed") || h.has("taggedpitchtype") || h.has("inducedvertbreak")) return "trackman";
  return null;
}

export function mediaTypeFor(filename: string, declared: string | null | undefined): string | null {
  if (declared && IMAGE_TYPES.has(declared)) return declared;
  const ext = filename.toLowerCase().split(".").pop();
  const byExt: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", pdf: "application/pdf" };
  return ext ? (byExt[ext] ?? null) : null;
}
