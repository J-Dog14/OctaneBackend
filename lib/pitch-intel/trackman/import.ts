/**
 * Trackman file uploads: preview (parse, auto-tag, find each pitcher's athlete)
 * and commit (apply the reviewer's edits, link pitchers, upsert pitches).
 *
 * Stateless by design: the commit re-reads the same file and applies only the
 * reviewer's choices (pitch types, session types, pitcher -> athlete), so the
 * numbers saved always come from the file itself.
 */

import { getDb } from "../db";
import { suggestAthletes, type AthleteSuggestion } from "../links";
import { isPitchCode, type PitchCode } from "../pitch-types";
import { classifySession } from "./classify";
import { displayName, normalizeTrackman, type SessionType, type TrackmanPitch } from "./normalize";

export interface TrackmanPitcherPreview {
  key: string;
  pitcherId: string | null;
  name: string;
  displayName: string;
  throws: "L" | "R" | null;
  pitchCount: number;
  link: { linkId: number; athleteUuid: string; athleteName: string; level: string | null } | null;
  suggestions: AthleteSuggestion[];
}

export interface TrackmanSessionPreview {
  key: string; // pitcherKey|date
  pitcherKey: string;
  date: string;
  sessionType: SessionType;
  pitchCount: number;
  alreadySaved: number;
}

export interface TrackmanPitchPreview {
  uid: string;
  pitcherKey: string;
  date: string;
  pitchNo: number | null;
  velo: number | null;
  spin: number | null;
  ivb: number | null;
  hb: number | null;
  ext: number | null;
  spinEff: number | null;
  tagged: PitchCode | null;
  auto: PitchCode | null;
  type: PitchCode;
}

export interface TrackmanPreview {
  kind: "trackman";
  filename: string;
  pitchers: TrackmanPitcherPreview[];
  sessions: TrackmanSessionPreview[];
  pitches: TrackmanPitchPreview[];
  skipped: number;
  warnings: string[];
}

export interface TrackmanCommitChoices {
  /** pitch uid -> final pitch code */
  pitchTypes?: Record<string, string>;
  /** pitcherKey|date -> session type */
  sessionTypes?: Record<string, SessionType>;
  /** pitcherKey -> athlete (+ level for new links); pitchers left out are not saved */
  pitchers: Record<string, { athleteUuid: string; level?: string | null }>;
}

const REQUIRED = ["RelSpeed", "InducedVertBreak", "HorzBreak"];

/** Parses and auto-tags; one classifier pass per pitcher per date. */
export function analyzeTrackman(headers: string[], rows: Record<string, string>[]) {
  const lower = new Set(headers.map((h) => h.toLowerCase()));
  const warnings: string[] = [];
  const missing = REQUIRED.filter((c) => !lower.has(c.toLowerCase()));
  if (missing.length) throw new Error(`This doesn't look like a complete Trackman export: missing ${missing.join(", ")}`);
  if (!lower.has("pitcherid")) warnings.push("No PitcherId column: pitchers are matched by name.");

  const { pitches, skipped } = normalizeTrackman(headers, rows);
  const bySession = new Map<string, TrackmanPitch[]>();
  for (const p of pitches) {
    const k = `${p.pitcherKey}|${p.date}`;
    if (!bySession.has(k)) bySession.set(k, []);
    bySession.get(k)!.push(p);
  }
  for (const group of bySession.values()) {
    const codes = classifySession(group.map((p) => ({ velo: p.relSpeed, spin: p.spinRate, ivb: p.ivb, hb: p.hb, throws: p.throws })));
    group.forEach((p, i) => (p.autoCode = codes[i]));
  }
  const dupes = pitches.length - new Set(pitches.map((p) => p.uid)).size;
  if (dupes) warnings.push(`${dupes} duplicate pitches in the file will be saved once.`);
  const untagged = pitches.filter((p) => !p.taggedCode).length;
  if (untagged) warnings.push(`${untagged} of ${pitches.length} pitches had no pitch type in the file and were auto-tagged. Review them before saving.`);
  if (skipped) warnings.push(`${skipped} rows had no pitcher, date or velocity and were skipped.`);
  return { pitches, bySession, skipped, warnings };
}

async function trackmanLinks(keys: string[]) {
  if (!keys.length) return [];
  return (await getDb()).query<{ link_id: number; source_player_id: string; athlete_uuid: string; athlete_name: string; level: string | null }>(
    `SELECT l.id::int AS link_id, l.source_player_id, l.athlete_uuid, a.name AS athlete_name, l.level
       FROM pitch_intel.athlete_source_links l
       JOIN analytics.d_athletes a ON a.athlete_uuid = l.athlete_uuid
      WHERE l.source = 'trackman' AND l.source_player_id = ANY($1::text[])`,
    keys,
  );
}

export async function previewTrackman(filename: string, headers: string[], rows: Record<string, string>[]): Promise<TrackmanPreview> {
  const { pitches, bySession, skipped, warnings } = analyzeTrackman(headers, rows);

  const pitcherMap = new Map<string, TrackmanPitch[]>();
  for (const p of pitches) {
    if (!pitcherMap.has(p.pitcherKey)) pitcherMap.set(p.pitcherKey, []);
    pitcherMap.get(p.pitcherKey)!.push(p);
  }
  const links = await trackmanLinks([...pitcherMap.keys()]);
  const linkBy = new Map(links.map((l) => [l.source_player_id, l]));

  const pitchers: TrackmanPitcherPreview[] = [];
  for (const [key, list] of pitcherMap) {
    const first = list[0];
    const link = linkBy.get(key);
    pitchers.push({
      key,
      pitcherId: first.pitcherId,
      name: first.pitcherName,
      displayName: displayName(first.pitcherName),
      throws: first.throws,
      pitchCount: list.length,
      link: link ? { linkId: link.link_id, athleteUuid: link.athlete_uuid, athleteName: link.athlete_name, level: link.level } : null,
      suggestions: link ? [] : await suggestAthletes(displayName(first.pitcherName), 6),
    });
  }

  const uids = pitches.map((p) => p.uid);
  const saved = new Set(
    uids.length
      ? (await (await getDb()).query<{ pitch_uid: string }>(`SELECT pitch_uid FROM pitch_intel.trackman_pitches WHERE pitch_uid = ANY($1::text[])`, uids)).map((r) => r.pitch_uid)
      : [],
  );

  const sessions: TrackmanSessionPreview[] = [...bySession.entries()].map(([key, list]) => ({
    key,
    pitcherKey: list[0].pitcherKey,
    date: list[0].date,
    sessionType: list[0].sessionType,
    pitchCount: list.length,
    alreadySaved: list.filter((p) => saved.has(p.uid)).length,
  }));
  if (saved.size) warnings.push(`${saved.size} of these pitches are already saved; saving again updates them.`);

  return {
    kind: "trackman",
    filename,
    pitchers,
    sessions,
    pitches: pitches.map((p) => ({
      uid: p.uid,
      pitcherKey: p.pitcherKey,
      date: p.date,
      pitchNo: p.pitchNo,
      velo: p.relSpeed,
      spin: p.spinRate,
      ivb: p.ivb,
      hb: p.hb,
      ext: p.extension,
      spinEff: p.spinEfficiency,
      tagged: p.taggedCode,
      auto: p.autoCode,
      type: p.taggedCode ?? p.autoCode ?? "OTHER",
    })),
    skipped,
    warnings,
  };
}

const UPSERT_COLUMNS = [
  "pitch_uid", "athlete_uuid", "link_id", "session_date", "session_type", "pitch_no", "pitch_time",
  "pitcher_name", "pitcher_id", "pitcher_throws", "tagged_pitch_type", "auto_pitch_type", "pitch_type",
  "rel_speed", "spin_rate", "spin_axis", "ivb", "hb", "rel_height", "rel_side", "extension", "vaa", "haa",
  "plate_loc_height", "plate_loc_side", "spin_efficiency", "pitch_call", "kor_bb", "play_result",
  "batter_side", "balls", "strikes", "exit_speed", "raw", "source_file", "upload_id",
];
const UPSERT_SQL = `
  INSERT INTO pitch_intel.trackman_pitches (${UPSERT_COLUMNS.join(", ")}, updated_at)
  SELECT ${UPSERT_COLUMNS.join(", ")}, NOW()
    FROM jsonb_populate_recordset(NULL::pitch_intel.trackman_pitches, $1::jsonb)
  ON CONFLICT (pitch_uid) DO UPDATE SET
    ${UPSERT_COLUMNS.filter((c) => c !== "pitch_uid").map((c) => `${c} = EXCLUDED.${c}`).join(",\n    ")},
    updated_at = NOW()
  RETURNING (xmax = 0) AS inserted`;

async function ensureTrackmanLink(
  key: string,
  pitcher: TrackmanPitch,
  athleteUuid: string,
  level: string | null | undefined,
  linkedBy: string | null,
): Promise<number> {
  const conn = await getDb();
  const existing = await conn.query<{ id: number; athlete_uuid: string }>(
    `SELECT id::int AS id, athlete_uuid FROM pitch_intel.athlete_source_links WHERE source = 'trackman' AND source_player_id = $1`,
    key,
  );
  if (existing.length) {
    if (existing[0].athlete_uuid !== athleteUuid) {
      throw new Error(`Trackman pitcher ${pitcher.pitcherName} is already linked to a different athlete. Unlink them first.`);
    }
    if (level) await conn.exec(`UPDATE pitch_intel.athlete_source_links SET level = $2 WHERE id = $1 AND level IS NULL`, existing[0].id, level);
    return existing[0].id;
  }
  const athlete = await conn.query<{ n: number }>(`SELECT count(*)::int AS n FROM analytics.d_athletes WHERE athlete_uuid = $1`, athleteUuid);
  if (!athlete[0]?.n) throw new Error("Selected athlete doesn't exist in the database.");
  const rows = await conn.query<{ id: number }>(
    `INSERT INTO pitch_intel.athlete_source_links
       (athlete_uuid, source, source_player_id, source_player_name, throws, level, league, pull_enabled, linked_by)
     VALUES ($1, 'trackman', $2, $3, $4, $5, $5, FALSE, $6)
     RETURNING id::int AS id`,
    athleteUuid,
    key,
    displayName(pitcher.pitcherName),
    pitcher.throws,
    level ?? null,
    linkedBy,
  );
  return rows[0].id;
}

export interface TrackmanCommitResult {
  uploadId: number;
  saved: number;
  inserted: number;
  updated: number;
  skippedPitchers: string[];
  athletes: Array<{ athleteUuid: string; pitches: number }>;
}

export async function commitTrackman(
  filename: string,
  headers: string[],
  rows: Record<string, string>[],
  choices: TrackmanCommitChoices,
  uploadedBy: string | null,
): Promise<TrackmanCommitResult> {
  const { pitches } = analyzeTrackman(headers, rows);
  const conn = await getDb();

  const upload = await conn.query<{ id: number }>(
    `INSERT INTO pitch_intel.uploads (kind, filename, uploaded_by) VALUES ('trackman', $1, $2) RETURNING id::int AS id`,
    filename,
    uploadedBy,
  );
  const uploadId = upload[0].id;

  const byPitcher = new Map<string, TrackmanPitch[]>();
  for (const p of pitches) {
    if (!byPitcher.has(p.pitcherKey)) byPitcher.set(p.pitcherKey, []);
    byPitcher.get(p.pitcherKey)!.push(p);
  }

  let inserted = 0;
  let updated = 0;
  const skippedPitchers: string[] = [];
  const athletes: TrackmanCommitResult["athletes"] = [];
  for (const [key, list] of byPitcher) {
    const choice = choices.pitchers[key];
    if (!choice?.athleteUuid) {
      skippedPitchers.push(displayName(list[0].pitcherName));
      continue;
    }
    const linkId = await ensureTrackmanLink(key, list[0], choice.athleteUuid, choice.level, uploadedBy);
    const seen = new Set<string>();
    const records = list
      .filter((p) => (seen.has(p.uid) ? false : (seen.add(p.uid), true)))
      .map((p) => {
        const override = choices.pitchTypes?.[p.uid];
        const sessionOverride = choices.sessionTypes?.[`${p.pitcherKey}|${p.date}`];
        return {
          pitch_uid: p.uid,
          athlete_uuid: choice.athleteUuid,
          link_id: linkId,
          session_date: p.date,
          session_type: sessionOverride === "game" || sessionOverride === "bullpen" ? sessionOverride : p.sessionType,
          pitch_no: p.pitchNo,
          pitch_time: p.time,
          pitcher_name: p.pitcherName,
          pitcher_id: p.pitcherId,
          pitcher_throws: p.throws,
          tagged_pitch_type: p.taggedCode,
          auto_pitch_type: p.autoCode,
          pitch_type: isPitchCode(override) ? override : (p.taggedCode ?? p.autoCode ?? "OTHER"),
          rel_speed: p.relSpeed,
          spin_rate: p.spinRate,
          spin_axis: p.spinAxis,
          ivb: p.ivb,
          hb: p.hb,
          rel_height: p.relHeight,
          rel_side: p.relSide,
          extension: p.extension,
          vaa: p.vaa,
          haa: p.haa,
          plate_loc_height: p.plateLocHeight,
          plate_loc_side: p.plateLocSide,
          spin_efficiency: p.spinEfficiency,
          pitch_call: p.pitchCall,
          kor_bb: p.korBB,
          play_result: p.playResult,
          batter_side: p.batterSide,
          balls: p.balls,
          strikes: p.strikes,
          exit_speed: p.exitSpeed,
          raw: p.raw,
          source_file: filename,
          upload_id: uploadId,
        };
      });
    for (let i = 0; i < records.length; i += 500) {
      const res = await conn.query<{ inserted: boolean }>(UPSERT_SQL, JSON.stringify(records.slice(i, i + 500)));
      for (const r of res) (r.inserted ? inserted++ : updated++);
    }
    await conn.exec(
      `UPDATE pitch_intel.athlete_source_links
          SET last_pulled_at = NOW(),
              last_game_date = (SELECT max(session_date) FROM pitch_intel.trackman_pitches WHERE link_id = $1)
        WHERE id = $1`,
      linkId,
    );
    athletes.push({ athleteUuid: choice.athleteUuid, pitches: records.length });
  }

  const saved = inserted + updated;
  await conn.exec(
    `UPDATE pitch_intel.uploads SET rows_saved = $2, summary = $3::jsonb WHERE id = $1`,
    uploadId,
    saved,
    JSON.stringify({ inserted, updated, skippedPitchers, athletes }),
  );
  return { uploadId, saved, inserted, updated, skippedPitchers, athletes };
}
