/** Saves a reviewed screenshot report (per-pitch-type averages) for an athlete. */

import { getDb } from "../db";
import { isPitchCode } from "../pitch-types";
import { REPORT_SOURCES, type ReportExtraction, type ReportPitchRow, type ReportSource } from "./vision";

export interface SaveReportInput {
  athleteUuid: string;
  source: ReportSource;
  reportDate: string | null;
  season: number | null;
  level: string | null;
  throws: "L" | "R" | null;
  title: string | null;
  notes: string | null;
  pitches: ReportPitchRow[];
  /** What the AI originally read, kept for reference. */
  extracted: ReportExtraction | null;
  filename: string;
}

export async function saveReport(input: SaveReportInput, uploadedBy: string | null): Promise<{ reportId: number; rows: number }> {
  if (!REPORT_SOURCES.includes(input.source)) throw new Error("Unknown report source");
  const rows = input.pitches.filter((p) => isPitchCode(p.pitchType));
  if (!rows.length) throw new Error("Add at least one pitch row before saving.");
  const conn = await getDb();
  const athlete = await conn.query<{ n: number }>(`SELECT count(*)::int AS n FROM analytics.d_athletes WHERE athlete_uuid = $1`, input.athleteUuid);
  if (!athlete[0]?.n) throw new Error("Selected athlete doesn't exist in the database.");

  const upload = await conn.query<{ id: number }>(
    `INSERT INTO pitch_intel.uploads (kind, filename, uploaded_by, rows_saved) VALUES ('screenshot', $1, $2, $3) RETURNING id::int AS id`,
    input.filename,
    uploadedBy,
    rows.length,
  );
  const report = await conn.query<{ id: number }>(
    `INSERT INTO pitch_intel.aggregate_reports
       (athlete_uuid, source, report_date, season, level, throws, title, notes, extracted, upload_id, created_by)
     VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
     RETURNING id::int AS id`,
    input.athleteUuid,
    input.source,
    input.reportDate,
    input.season,
    input.level,
    input.throws,
    input.title,
    input.notes,
    JSON.stringify(input.extracted ?? {}),
    upload[0].id,
    uploadedBy,
  );
  const reportId = report[0].id;
  await conn.exec(
    `INSERT INTO pitch_intel.aggregate_pitch_rows
       (report_id, pitch_type, pitch_count, usage_pct, velo, velo_max, spin_rate, ivb, hb_arm, extension,
        rel_height, rel_side, vaa, spin_efficiency, whiff_pct, extra)
     SELECT $1, r.pitch_type, r.pitch_count, r.usage_pct, r.velo, r.velo_max, r.spin_rate, r.ivb, r.hb_arm, r.extension,
            r.rel_height, r.rel_side, r.vaa, r.spin_efficiency, r.whiff_pct, COALESCE(r.extra, '{}'::jsonb)
       FROM jsonb_populate_recordset(NULL::pitch_intel.aggregate_pitch_rows, $2::jsonb) r`,
    reportId,
    JSON.stringify(
      rows.map((p) => ({
        pitch_type: p.pitchType,
        pitch_count: p.count,
        usage_pct: p.usagePct,
        velo: p.velo,
        velo_max: p.veloMax,
        spin_rate: p.spinRate,
        ivb: p.ivb,
        hb_arm: p.hbArm,
        extension: p.extension,
        rel_height: p.relHeight,
        rel_side: p.relSide,
        vaa: p.vaa,
        spin_efficiency: p.spinEfficiency,
        whiff_pct: p.whiffPct,
        extra: { label: p.label, hb_as_shown: p.hbAsShown },
      })),
    ),
  );
  return { reportId, rows: rows.length };
}

export async function deleteReport(reportId: number): Promise<void> {
  await (await getDb()).exec(`DELETE FROM pitch_intel.aggregate_reports WHERE id = $1`, reportId);
}
