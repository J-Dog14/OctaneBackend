/**
 * Speaks the same protocol as Ryan's Google Apps Script backend (Code.gs), so
 * his dashboard (public/pitch-intel-app/) runs unchanged on our data.
 *
 *   getAthletes             -> linked athletes (Savant and/or Trackman), in his Athletes-sheet shape
 *   getOutings {athleteId}  -> outings built with his own parsers and his Bulk Import -> Code.gs
 *                              mapping: Savant games (parseStatcastBulk on pitch_intel.savant_pitches)
 *                              plus uploaded Trackman games (parseTrackmanBulk on the original rows
 *                              in pitch_intel.trackman_pitches, with the reviewed pitch types).
 *                              Savant wins when both have the same date. Bullpens stay out (Sessions page).
 *   scoreArsenal            -> graded here with Octane's xArsenal engine (or his Worker if
 *                              PITCH_INTEL_XARSENAL_URL is set)
 *   analyze                 -> Claude, same request as his Code.gs, if ANTHROPIC_API_KEY is set
 *   anything that writes    -> refused (data comes from the nightly pulls)
 *
 * Errors are returned as { error } with HTTP 200, as his frontend expects.
 */

import { SAVANT_COLUMNS } from "../savant/columns";
import { CODE_TO_TRACKMAN, isPitchCode } from "../pitch-types";
import { parseStatcastBulk, parseTrackmanBulk, type RyanParsedOuting, type StatcastCsvRow } from "./ryan-statcast";

type Query = <T>(sql: string, ...params: unknown[]) => Promise<T[]>;

async function query<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const { prisma } = await import("../../db/prisma");
  return prisma.$queryRawUnsafe<T[]>(sql, ...params);
}

let run: Query = query;
/** Tests can point the adapter at another connection. */
export function setLegacyQuery(q: Query): void {
  run = q;
}

const WRITE_ACTIONS = new Set(["addAthlete", "updateAthlete", "deleteAthlete", "addOuting", "deleteOuting"]);
const READ_ONLY = "Read-only here: Pitch Intelligence data comes from the nightly Baseball Savant pulls and the upload page.";

// ---------------------------------------------------------------------------
// Athletes
// ---------------------------------------------------------------------------

interface LinkRow {
  athlete_uuid: string;
  source: "savant" | "trackman";
  name: string;
  throws: string | null;
  level: string | null;
  league: string | null;
  linked_at: string;
  last_pulled_at: string | null;
  link_id: number;
}

async function linkedAthletes(): Promise<LinkRow[]> {
  return run<LinkRow>(
    `SELECT l.athlete_uuid, l.source, a.name, l.throws, l.level, l.league, l.linked_at::text AS linked_at,
            to_char(l.last_pulled_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD"T"HH24:MI:SS') AS last_pulled_at,
            l.id::int AS link_id
       FROM pitch_intel.athlete_source_links l
       JOIN analytics.d_athletes a ON a.athlete_uuid = l.athlete_uuid
      ORDER BY a.name, (l.source = 'savant') DESC, l.id`,
  );
}

interface AthleteLinks {
  athleteUuid: string;
  savant: LinkRow | null;
  trackman: LinkRow[];
  /** Savant link first, else the first Trackman link: drives name, throws, level. */
  primary: LinkRow;
}

function groupLinks(rows: LinkRow[]): AthleteLinks[] {
  const map = new Map<string, AthleteLinks>();
  for (const l of rows) {
    let a = map.get(l.athlete_uuid);
    if (!a) {
      a = { athleteUuid: l.athlete_uuid, savant: null, trackman: [], primary: l };
      map.set(l.athlete_uuid, a);
    }
    if (l.source === "savant") {
      if (!a.savant) a.savant = l;
      a.primary = a.savant;
    } else {
      a.trackman.push(l);
    }
  }
  return [...map.values()];
}

/** Ryan's Athletes sheet row: id,name,position,throws,team,level,notes,pitch_metrics_json,createdAt (+ parsed pitch_metrics). */
function toRyanAthlete(a: AthleteLinks) {
  const l = a.primary;
  const all = [a.savant, ...a.trackman].filter((x): x is LinkRow => x != null);
  return {
    id: l.athlete_uuid,
    name: l.name,
    position: "P",
    throws: all.find((x) => x.throws)?.throws ?? "R",
    team: "",
    // Drives his FIP league (ALPB vs MLB constant) and the xArsenal grading level.
    level: l.league || l.level || all.map((x) => x.league || x.level).find(Boolean) || "",
    notes: "",
    pitch_metrics_json: "{}",
    pitch_metrics: {},
    createdAt: l.linked_at,
  };
}

export async function getAthletes() {
  return { athletes: groupLinks(await linkedAthletes()).map(toRyanAthlete) };
}

// ---------------------------------------------------------------------------
// Outings
// ---------------------------------------------------------------------------

const SELECT_PITCHES = `
  SELECT ${SAVANT_COLUMNS.map(([c]) => `"${c}"::text AS "${c}"`).join(", ")}, raw_extra
    FROM pitch_intel.savant_pitches
   WHERE link_id = $1
   ORDER BY game_date DESC, game_pk DESC, at_bat_number DESC, pitch_number DESC`;

/** Database rows back to the CSV-style rows Ryan's parser reads (strings, blanks as ""). */
export function toCsvRow(row: Record<string, unknown>): StatcastCsvRow {
  const out: StatcastCsvRow = {};
  const extra = row.raw_extra;
  if (extra && typeof extra === "object") {
    for (const [k, v] of Object.entries(extra as Record<string, unknown>)) out[k] = v == null ? "" : String(v);
  }
  for (const [c] of SAVANT_COLUMNS) {
    const v = row[c];
    out[c] = v == null ? "" : String(v);
  }
  return out;
}

/**
 * Turns Ryan's parsed outings into the rows his Code.gs getOutings returns,
 * following his Bulk Import (drop empty pitch types, one outing per date,
 * first one wins) and Code.gs addOuting (column-by-column values).
 */
export function toSheetOutings(athleteId: string, linkId: number, parsed: RyanParsedOuting[], updatedAt: string | null = null) {
  const seenDates = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  for (const o of parsed) {
    const dateKey = (o.date || "").toString().split("T")[0];
    if (dateKey && seenDates.has(dateKey)) continue; // Code.gs dedupes on athlete + date
    if (dateKey) seenDates.add(dateKey);

    // runBulkImport: cleanMap + stats
    const pm: RyanParsedOuting["pitchMap"] = {};
    Object.entries(o.pitchMap).forEach(([pt, s]) => {
      if (s.count > 0) pm[pt] = s;
    });
    const s = {
      total: o.total_pitches, whiffs: o.whiffs, calledStrikes: o.calledStrikes,
      walks: o.walks, ks: o.ks, hbp: o.hbp || 0, hrs: o.hrs || 0, hits: o.hits || 0, ip: o.ip || 0,
      avgEV: o.avgEV, hardHitPct: o.hardHitPct,
      zonePct: o.zonePct, oSwingPct: o.oSwingPct, zSwingPct: o.zSwingPct,
      zContactPct: o.zContactPct, swingPct: o.swingPct, strikePct: o.strikePct,
      gbPct: o.gbPct, fbPct: o.fbPct, ldPct: o.ldPct,
      fpStrikePct: o.fpStrikePct, oonStrikePct: o.oonStrikePct,
      race2kPct: o.race2kPct, putawayPct: o.putawayPct,
    };

    // Code.gs addOuting, values written by header name
    const ps = (pt: string, key: string) => (pm[pt] && pm[pt][key] !== undefined ? pm[pt][key] : "");
    const pct = (pt: string) => (pm[pt] ? +((pm[pt].count / (s.total || 1)) * 100).toFixed(1) : 0);
    const values: Record<string, unknown> = {
      id: `out_${linkId}_${dateKey}`, athleteId, date: o.date || "", opponent: o.opponent || "",
      inning_start: "", notes: "",
      total_pitches: s.total || 0, strikes: 0, balls: 0, whiffs: s.whiffs || 0,
      called_strikes: s.calledStrikes || 0, walks: s.walks || 0, strikeouts: s.ks || 0, hrs: s.hrs || 0, hits: s.hits || 0, ip: s.ip || 0,
      pitch_stats_json: JSON.stringify(pm),
      ff_pct: pct("FF"), st_pct: pct("ST"), fs_pct: pct("FS"), fc_pct: pct("FC"), cu_pct: pct("CU"), sl_pct: pct("SL"), si_pct: pct("SI"), ch_pct: pct("CH"),
      ff_velo: ps("FF", "avgVelo"), ff_whiff: ps("FF", "whiffPct"), st_whiff: ps("ST", "whiffPct"), fs_whiff: ps("FS", "whiffPct"), cu_whiff: ps("CU", "whiffPct"),
      avg_ev: s.avgEV || "", hard_hit_pct: s.hardHitPct || "",
      zone_pct: s.zonePct || "", o_swing_pct: s.oSwingPct || "", z_swing_pct: s.zSwingPct || "", z_contact_pct: s.zContactPct || "",
      swing_pct: s.swingPct || "", strike_pct: s.strikePct || "",
      gb_pct: s.gbPct || "", fb_pct: s.fbPct || "", ld_pct: s.ldPct || "",
      fp_strike_pct: s.fpStrikePct || "", oon_strike_pct: s.oonStrikePct || "",
      race2k_pct: s.race2kPct || "", putaway_pct: s.putawayPct || "",
      // His hero shows "Last CSV updated" from this; here it is the last Savant pull.
      createdAt: updatedAt ?? "",
      sit_json: o.sit ? JSON.stringify(o.sit) : "",
    };
    // Code.gs getOutings adds the parsed pitch map
    values.pitch_stats = JSON.parse(values.pitch_stats_json as string);
    rows.push(values);
  }
  return rows;
}

const SELECT_TRACKMAN_GAMES = `
  SELECT raw, pitch_type, session_date::text AS session_date
    FROM pitch_intel.trackman_pitches
   WHERE link_id = $1 AND session_type = 'game'
   ORDER BY session_date, pitch_no NULLS LAST, pitch_time NULLS LAST, pitch_uid`;

/**
 * Stored Trackman rows back to the rows Ryan's parseTrackmanBulk reads: the
 * original file columns, with the reviewed pitch type written into
 * TaggedPitchType and the date normalized to YYYY-MM-DD.
 */
export function toTrackmanRow(row: { raw: unknown; pitch_type: string; session_date: string }): Record<string, string> {
  const out: Record<string, string> = {};
  if (row.raw && typeof row.raw === "object") {
    for (const [k, v] of Object.entries(row.raw as Record<string, unknown>)) out[k] = v == null ? "" : String(v);
  }
  // His parser reads Date/date and TaggedPitchType/taggedpitchtype; drop other spellings so ours win.
  for (const k of Object.keys(out)) {
    const lk = k.toLowerCase();
    if (lk === "date" || lk === "taggedpitchtype" || lk === "autopitchtype") delete out[k];
  }
  out.Date = row.session_date;
  out.TaggedPitchType = isPitchCode(row.pitch_type) ? CODE_TO_TRACKMAN[row.pitch_type] : "Other";
  return out;
}

export async function getOutings(athleteId: string | undefined) {
  if (!athleteId) return { error: "athleteId required" };
  const athlete = groupLinks(await linkedAthletes()).find((a) => a.athleteUuid === athleteId);
  if (!athlete) return { outings: [] };

  const outings: Array<Record<string, unknown>> = [];
  if (athlete.savant) {
    const dbRows = await run<Record<string, unknown>>(SELECT_PITCHES, athlete.savant.link_id);
    if (dbRows.length) {
      const parsed = parseStatcastBulk(dbRows.map(toCsvRow)).outings;
      outings.push(...toSheetOutings(athleteId, athlete.savant.link_id, parsed, athlete.savant.last_pulled_at));
    }
  }
  for (const link of athlete.trackman) {
    const tmRows = await run<{ raw: unknown; pitch_type: string; session_date: string }>(SELECT_TRACKMAN_GAMES, link.link_id);
    if (!tmRows.length) continue;
    const parsed = parseTrackmanBulk(tmRows.map(toTrackmanRow)).outings;
    const taken = new Set(outings.map((o) => String(o.date).split("T")[0]));
    for (const o of toSheetOutings(athleteId, link.link_id, parsed, link.last_pulled_at)) {
      if (!taken.has(String(o.date).split("T")[0])) outings.push(o);
    }
  }
  return { outings };
}

// ---------------------------------------------------------------------------
// xArsenal and AI insights (optional, configured by environment variables)
// ---------------------------------------------------------------------------

/**
 * xArsenal grades. Computed here with Octane's engine (lib/pitch-intel/xarsenal).
 * Set PITCH_INTEL_XARSENAL_URL to use Ryan's Worker instead (e.g. to compare).
 */
async function scoreArsenal(body: Record<string, unknown>) {
  const { action: _ignored, ...payload } = body;
  void _ignored;
  const url = process.env.PITCH_INTEL_XARSENAL_URL;
  if (!url) {
    const { scoreArsenalBody } = await import("../xarsenal/score");
    return scoreArsenalBody(payload);
  }
  const res = await fetch(`${url.replace(/\/+$/, "")}/?action=scoreArsenal`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: `xArsenal service returned HTTP ${res.status}` };
  }
}

/** Same request and JSON extraction as Ryan's Code.gs callClaude. */
async function analyze(body: Record<string, unknown>) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: "AI insights aren't set up yet. Add ANTHROPIC_API_KEY to the backend's environment." };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.PITCH_INTEL_AI_MODEL || "claude-sonnet-4-5",
      max_tokens: 4096,
      messages: body.messages,
    }),
    cache: "no-store",
  });
  const data = (await res.json()) as { error?: { message?: string }; content?: Array<{ text?: string }>; stop_reason?: string };
  if (data.error) return { error: data.error.message ?? "AI request failed" };
  const raw = data.content?.map((c) => c.text || "").join("") || "";
  const fenceStripped = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const match = fenceStripped.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      error:
        data.stop_reason === "max_tokens"
          ? "AI response was cut off before it finished (hit the token limit). Try again."
          : "AI response did not contain valid JSON.",
    };
  }
  return { text: match[0] };
}

// ---------------------------------------------------------------------------

export async function handleLegacyAction(action: string | undefined, body: Record<string, unknown>): Promise<unknown> {
  switch (action) {
    case "getAthletes":
      return getAthletes();
    case "getOutings":
      return getOutings(typeof body.athleteId === "string" ? body.athleteId : undefined);
    case "scoreArsenal":
      return scoreArsenal(body);
    case "analyze":
      return analyze(body);
    case "version":
      return { version: "pitch-intel-adapter-1", sitJson: true };
    default:
      if (action && WRITE_ACTIONS.has(action)) return { error: READ_ONLY };
      return { error: `Unknown action: ${action}` };
  }
}
