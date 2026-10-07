/**
 * Upload page backend: one entry point for previews and one for saves, for
 * every kind of file (Trackman CSV/XLSX, Savant CSV/XLSX, screenshots/PDFs).
 */

import { getLink } from "../db";
import { detectSpreadsheet, mediaTypeFor, readSpreadsheet } from "../files/detect";
import { suggestAthletes, type AthleteSuggestion } from "../links";
import { extractReport, visionConfigured, type ReportExtraction } from "../reports/vision";
import { saveReport, type SaveReportInput } from "../reports/save";
import { commitTrackman, previewTrackman, type TrackmanCommitChoices, type TrackmanPreview } from "../trackman/import";
import { commitSavant, previewSavant, type SavantPreview } from "./savant";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export interface ScreenshotPreview {
  kind: "screenshot";
  filename: string;
  extraction: ReportExtraction;
  suggestions: AthleteSuggestion[];
  warnings: string[];
}

export type UploadPreview = TrackmanPreview | SavantPreview | ScreenshotPreview;

export class UploadError extends Error {}

function checkSize(bytes: Buffer) {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadError(`File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  if (!bytes.length) throw new UploadError("The file is empty.");
}

export async function previewUpload(filename: string, declaredType: string | null, bytes: Buffer): Promise<UploadPreview> {
  checkSize(bytes);
  const media = mediaTypeFor(filename, declaredType);
  if (media) {
    if (!visionConfigured()) throw new UploadError("Screenshot reading isn't set up yet: add ANTHROPIC_API_KEY to the backend's environment.");
    const extraction = await extractReport(bytes, media);
    const warnings: string[] = [];
    if (!extraction.pitches.length) warnings.push("No pitch rows were found in this image.");
    if (extraction.pitches.some((p) => p.hbAsShown != null && p.hbArm == null)) {
      warnings.push("Couldn't tell which way horizontal break points on some rows. Fill in arm-side HB (positive = arm side) before saving.");
    }
    return {
      kind: "screenshot",
      filename,
      extraction,
      suggestions: extraction.playerName ? await suggestAthletes(extraction.playerName, 6) : [],
      warnings,
    };
  }

  const { headers, rows } = readSpreadsheet(filename, bytes);
  if (!rows.length) throw new UploadError("No data rows found in that file.");
  const kind = detectSpreadsheet(headers);
  if (kind === "trackman") return previewTrackman(filename, headers, rows);
  if (kind === "savant") return previewSavant(filename, headers, rows);
  throw new UploadError("Couldn't recognize this file. Upload a Trackman export, a Baseball Savant pitch-by-pitch CSV, or a screenshot.");
}

export type CommitPayload =
  | { kind: "trackman"; choices: TrackmanCommitChoices }
  | { kind: "savant" }
  | { kind: "screenshot"; report: Omit<SaveReportInput, "filename"> };

export async function commitUpload(filename: string, bytes: Buffer | null, payload: CommitPayload, uploadedBy: string | null) {
  if (payload.kind === "screenshot") {
    const saved = await saveReport({ ...payload.report, filename }, uploadedBy);
    return { kind: "screenshot" as const, athleteUuid: payload.report.athleteUuid, ...saved };
  }
  if (!bytes) throw new UploadError("The file is missing from the save request.");
  checkSize(bytes);
  const { headers, rows } = readSpreadsheet(filename, bytes);
  const kind = detectSpreadsheet(headers);
  if (payload.kind === "trackman") {
    if (kind !== "trackman") throw new UploadError("That file isn't a Trackman export.");
    return { kind: "trackman" as const, ...(await commitTrackman(filename, headers, rows, payload.choices, uploadedBy)) };
  }
  if (kind !== "savant") throw new UploadError("That file isn't a Savant pitch-by-pitch CSV.");
  const r = await commitSavant(filename, headers, rows, uploadedBy);
  const athleteUuid = (await getLink(r.linkId))?.athlete_uuid ?? null;
  return { kind: "savant" as const, athleteUuid, status: r.status, inserted: r.inserted, updated: r.updated, error: r.error ?? (r.fatal.join(" ") || null) };
}
