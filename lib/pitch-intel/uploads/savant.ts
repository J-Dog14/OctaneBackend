/** Hand-downloaded Baseball Savant files on the upload page (same checks and storage as the nightly pull). */

import type { CsvRow } from "../csv";
import { runChecks, type CheckResult } from "../checks";
import { getDb, getLinkBySourceId, type Link } from "../db";
import { importRows, type PullResult } from "../pull";

export interface SavantPreview {
  kind: "savant";
  filename: string;
  pitcherId: string | null;
  pitcherName: string | null;
  link: { linkId: number; athleteUuid: string; athleteName: string } | null;
  rows: number;
  checks: CheckResult;
  warnings: string[];
}

function pitcherOf(rows: CsvRow[]): { id: string | null; name: string | null; many: boolean } {
  const ids = new Set(rows.map((r) => (r.pitcher ?? "").trim()).filter(Boolean));
  const first = rows.find((r) => r.pitcher);
  return { id: first?.pitcher?.trim() ?? null, name: first?.player_name ?? null, many: ids.size > 1 };
}

export async function previewSavant(filename: string, headers: string[], rows: CsvRow[]): Promise<SavantPreview> {
  const p = pitcherOf(rows);
  const warnings: string[] = [];
  if (p.many) warnings.push("This file has more than one pitcher. Download one pitcher at a time from Savant.");
  const link = p.id ? await getLinkBySourceId("savant", p.id) : null;
  if (!link && p.id) warnings.push(`Savant player ${p.name ?? ""} (${p.id}) isn't linked yet. Link him with "Link athlete" first, then upload again.`);
  const checks = runChecks(headers, rows, p.id ?? "", { checkRowCap: true });
  return {
    kind: "savant",
    filename,
    pitcherId: p.id,
    pitcherName: p.name,
    link: link ? { linkId: link.id, athleteUuid: link.athlete_uuid, athleteName: link.athlete_name } : null,
    rows: rows.length,
    checks,
    warnings,
  };
}

export async function commitSavant(filename: string, headers: string[], rows: CsvRow[], uploadedBy: string | null): Promise<PullResult> {
  const p = pitcherOf(rows);
  if (p.many) throw new Error("This file has more than one pitcher.");
  const link: Link | null = p.id ? await getLinkBySourceId("savant", p.id) : null;
  if (!link) throw new Error("This Savant player isn't linked to an athlete yet.");
  const result = await importRows(link, { headers, rows });
  await (await getDb()).exec(
    `INSERT INTO pitch_intel.uploads (kind, filename, uploaded_by, rows_saved, summary) VALUES ('savant_csv', $1, $2, $3, $4::jsonb)`,
    filename,
    uploadedBy,
    result.inserted + result.updated,
    JSON.stringify({ status: result.status, inserted: result.inserted, updated: result.updated, error: result.error, runId: result.runId }),
  );
  return result;
}
