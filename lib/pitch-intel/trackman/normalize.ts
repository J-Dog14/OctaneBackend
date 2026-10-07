/**
 * Trackman rows (game or practice exports, CSV or XLSX) -> typed pitches.
 * Column lookup is case-insensitive; every original column is kept in `raw`.
 */

import { createHash } from "node:crypto";
import type { CsvRow } from "../csv";
import { excelSerialToIso } from "../files/xlsx";
import { normalizeName } from "../match";
import { codeFromTrackman, type PitchCode } from "../pitch-types";

export type SessionType = "game" | "bullpen";

export interface TrackmanPitch {
  uid: string;
  pitcherKey: string;
  pitcherId: string | null;
  pitcherName: string;
  throws: "L" | "R" | null;
  date: string;
  sessionType: SessionType;
  pitchNo: number | null;
  time: string | null;
  taggedCode: PitchCode | null;
  autoCode: PitchCode | null;
  relSpeed: number | null;
  spinRate: number | null;
  spinAxis: number | null;
  ivb: number | null;
  hb: number | null;
  relHeight: number | null;
  relSide: number | null;
  extension: number | null;
  vaa: number | null;
  haa: number | null;
  plateLocHeight: number | null;
  plateLocSide: number | null;
  spinEfficiency: number | null;
  pitchCall: string | null;
  korBB: string | null;
  playResult: string | null;
  batterSide: string | null;
  balls: number | null;
  strikes: number | null;
  exitSpeed: number | null;
  raw: CsvRow;
}

/** Case-insensitive getter over a file's header row. */
export function columnGetter(headers: string[]) {
  const byLower = new Map(headers.map((h) => [h.trim().toLowerCase(), h]));
  return (row: CsvRow, ...names: string[]): string | null => {
    for (const n of names) {
      const h = byLower.get(n.toLowerCase());
      if (h == null) continue;
      const v = (row[h] ?? "").trim();
      if (v !== "" && v.toLowerCase() !== "nan" && v.toLowerCase() !== "null") return v;
    }
    return null;
  };
}

const num = (v: string | null): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (v: string | null): number | null => {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
};

/** Trackman dates: 2024-06-21, 6/21/2024, 06/21/24, or an Excel serial number. */
export function toIsoDate(v: string | null): string | null {
  if (!v) return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const serial = Number(s);
  if (Number.isFinite(serial) && serial > 30000 && serial < 80000) return excelSerialToIso(serial);
  return null;
}

/** "McNeill, Brock" -> "Brock McNeill". */
export function displayName(trackmanName: string): string {
  const parts = trackmanName.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : trackmanName.trim();
}

export function pitcherKeyFor(pitcherId: string | null, name: string): string {
  return pitcherId ? pitcherId : `name:${normalizeName(displayName(name)).toLowerCase()}`;
}

/** A file is a game if any pitch has a pitch call or game id; otherwise a bullpen/practice session. */
export function detectSessionType(headers: string[], rows: CsvRow[]): SessionType {
  const get = columnGetter(headers);
  return rows.some((r) => get(r, "PitchCall", "GameID", "GameUID")) ? "game" : "bullpen";
}

export function normalizeTrackman(headers: string[], rows: CsvRow[]): { pitches: TrackmanPitch[]; skipped: number } {
  const get = columnGetter(headers);
  const sessionType = detectSessionType(headers, rows);
  const pitches: TrackmanPitch[] = [];
  let skipped = 0;
  for (const r of rows) {
    const name = get(r, "Pitcher") ?? "";
    const date = toIsoDate(get(r, "Date", "GameDate", "UTCDate"));
    const relSpeed = num(get(r, "RelSpeed"));
    if (!name || !date || relSpeed == null) {
      skipped++;
      continue;
    }
    const pitcherId = get(r, "PitcherId", "PitcherID");
    const time = get(r, "Time", "UTCTime");
    const pitchNo = int(get(r, "PitchNo"));
    const throwsRaw = (get(r, "PitcherThrows") ?? "").toLowerCase();
    const uid =
      get(r, "PitchUID", "PitchUid", "PlayID") ??
      `tm:${createHash("sha1").update([pitcherId ?? name, date, time ?? "", pitchNo ?? "", relSpeed].join("|")).digest("hex").slice(0, 24)}`;
    let spinEff = num(get(r, "SpinAxis3dSpinEfficiency", "SpinEfficiency"));
    if (spinEff != null && spinEff <= 1.0001) spinEff = spinEff * 100;

    pitches.push({
      uid,
      pitcherKey: pitcherKeyFor(pitcherId, name),
      pitcherId,
      pitcherName: name,
      throws: throwsRaw.startsWith("l") ? "L" : throwsRaw.startsWith("r") ? "R" : null,
      date,
      sessionType,
      pitchNo,
      time,
      taggedCode: codeFromTrackman(get(r, "TaggedPitchType")) ?? codeFromTrackman(get(r, "AutoPitchType")),
      autoCode: null,
      relSpeed,
      spinRate: num(get(r, "SpinRate")),
      spinAxis: num(get(r, "SpinAxis")),
      ivb: num(get(r, "InducedVertBreak")),
      hb: num(get(r, "HorzBreak")),
      relHeight: num(get(r, "RelHeight")),
      relSide: num(get(r, "RelSide")),
      extension: num(get(r, "Extension")),
      vaa: num(get(r, "VertApprAngle")),
      haa: num(get(r, "HorzApprAngle")),
      plateLocHeight: num(get(r, "PlateLocHeight")),
      plateLocSide: num(get(r, "PlateLocSide")),
      spinEfficiency: spinEff == null ? null : Math.round(spinEff * 10) / 10,
      pitchCall: get(r, "PitchCall"),
      korBB: get(r, "KorBB"),
      playResult: get(r, "PlayResult"),
      batterSide: get(r, "BatterSide"),
      balls: int(get(r, "Balls")),
      strikes: int(get(r, "Strikes")),
      exitSpeed: num(get(r, "ExitSpeed")),
      raw: r,
    });
  }
  return { pitches, skipped };
}
