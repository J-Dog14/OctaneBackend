/**
 * Baseball Savant HTTP client: pitch-by-pitch CSV downloads and player lookup.
 *
 * Endpoints (unofficial, used by pybaseball and Savant's own pages):
 *   MLB CSV     https://baseballsavant.mlb.com/statcast_search/csv
 *   Minors CSV  https://baseballsavant.mlb.com/statcast-search-minors/csv   (AAA 2023+, FSL 2021+)
 *   Search      https://baseballsavant.mlb.com/player/search-all?search=<name>
 *   By MLB ID   https://statsapi.mlb.com/api/v1/people/<id>?hydrate=currentTeam
 *
 * Downloads carry no filters beyond pitcher + date range ("clear every
 * filter", 01-DATA-INPUT.md): a swing filter would silently drop every take.
 */

import { REQUEST_TIMEOUT_MS } from "../config";

const SAVANT = "https://baseballsavant.mlb.com";
const USER_AGENT = "8ctane-biomech-backend/pitch-intel (low-volume nightly pull)";

export type SavantLevel = "mlb" | "minors";

export class SavantError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly url?: string,
  ) {
    super(message);
    this.name = "SavantError";
  }
}

export interface SavantPlayer {
  id: string;
  name: string;
  /** "RHP", "LHP", "TWP", "SS"... */
  position: string | null;
  throws: "L" | "R" | null;
  team: string | null;
  /** "MLB", "AAA", ... as Savant reports it. */
  league: string | null;
  isMlb: boolean;
  isPitcher: boolean;
  lastYear: number | null;
}

async function fetchWithTimeout(url: string, accept: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: accept },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timed out" : String(err);
    throw new SavantError(`Request to Savant failed: ${reason}`, undefined, url);
  } finally {
    clearTimeout(timer);
  }
}

export function savantCsvUrl(level: SavantLevel, mlbamId: string, from: string, to: string): string {
  const path = level === "mlb" ? "/statcast_search/csv" : "/statcast-search-minors/csv";
  const params = new URLSearchParams({
    all: "true",
    type: "details",
    player_type: "pitcher",
    "pitchers_lookup[]": mlbamId,
    game_date_gt: from,
    game_date_lt: to,
    hfGT: "",
    hfSea: "",
    min_pitches: "0",
    min_results: "0",
    min_abs: "0",
    group_by: "name",
    sort_col: "pitches",
    sort_order: "desc",
  });
  if (level === "minors") params.set("minors", "true");
  return `${SAVANT}${path}?${params.toString()}`;
}

/** Downloads one pitcher's pitch-by-pitch CSV for a date range. Empty string = no pitches. */
export async function fetchSavantCsv(
  level: SavantLevel,
  mlbamId: string,
  from: string,
  to: string,
): Promise<{ url: string; text: string }> {
  const url = savantCsvUrl(level, mlbamId, from, to);
  const res = await fetchWithTimeout(url, "text/csv,*/*");
  if (!res.ok) {
    throw new SavantError(`Savant returned HTTP ${res.status}`, res.status, url);
  }
  const text = await res.text();
  const head = text.trimStart().slice(0, 200).toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<")) {
    throw new SavantError("Savant returned a web page instead of a CSV (endpoint changed or blocked)", res.status, url);
  }
  return { url, text };
}

function throwsFromPosition(pos: string | null): "L" | "R" | null {
  if (!pos) return null;
  if (pos.startsWith("L")) return "L";
  if (pos.startsWith("R")) return "R";
  return null;
}

/** Savant's player search. Pitchers are listed first. */
export async function searchSavantPlayers(query: string): Promise<SavantPlayer[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `${SAVANT}/player/search-all?search=${encodeURIComponent(q)}`;
  const res = await fetchWithTimeout(url, "application/json");
  if (!res.ok) throw new SavantError(`Savant search returned HTTP ${res.status}`, res.status, url);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) return [];

  const players = data
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .filter((p) => String(p.is_player ?? "1") === "1" && p.id != null)
    .map((p): SavantPlayer => {
      const position = p.pos != null ? String(p.pos) : null;
      const lastYear = Number(p.last_year);
      return {
        id: String(p.id),
        name: String(p.name ?? p.first ?? ""),
        position,
        throws: throwsFromPosition(position),
        team: p.name_display_club != null ? String(p.name_display_club) : null,
        league: p.league != null ? String(p.league) : null,
        isMlb: String(p.mlb) === "1",
        isPitcher: !!position && (/P$/.test(position) || position === "TWP"),
        lastYear: Number.isFinite(lastYear) ? lastYear : null,
      };
    });

  return players.sort((a, b) => Number(b.isPitcher) - Number(a.isPitcher));
}

interface StatsApiPerson {
  id?: number;
  fullName?: string;
  pitchHand?: { code?: string };
  primaryPosition?: { abbreviation?: string };
  currentTeam?: { name?: string };
  mlbDebutDate?: string;
}

/** Looks up one player by MLB ID through the MLB Stats API (used when an ID or Savant URL is pasted). */
export async function getPlayerById(mlbamId: string): Promise<SavantPlayer | null> {
  const url = `https://statsapi.mlb.com/api/v1/people/${encodeURIComponent(mlbamId)}?hydrate=currentTeam`;
  const res = await fetchWithTimeout(url, "application/json");
  if (res.status === 404) return null;
  if (!res.ok) throw new SavantError(`MLB Stats API returned HTTP ${res.status}`, res.status, url);
  const data = (await res.json()) as { people?: StatsApiPerson[] };
  const p = data.people?.[0];
  if (!p) return null;
  const hand = p.pitchHand?.code;
  const position = p.primaryPosition?.abbreviation ?? null;
  return {
    id: String(p.id),
    name: String(p.fullName ?? ""),
    position: position === "P" && hand ? `${hand}HP` : position,
    throws: hand === "L" || hand === "R" ? hand : null,
    team: p.currentTeam?.name ?? null,
    league: null,
    isMlb: !!p.mlbDebutDate,
    isPitcher: position === "P" || position === "TWP",
    lastYear: null,
  };
}

/** Pulls an MLB ID out of a pasted ID or Savant player URL (".../savant-player/paul-skenes-694973"). */
export function parseMlbamId(input: string): string | null {
  const s = input.trim();
  if (/^\d{5,7}$/.test(s)) return s;
  const fromUrl = s.match(/baseballsavant\.mlb\.com\/savant-player\/[^?#]*?(\d{5,7})(?:[/?#]|$)/i);
  if (fromUrl) return fromUrl[1];
  const param = s.match(/[?&](?:playerId|player_id|pitchers_lookup(?:%5B%5D|\[\])?)=(\d{5,7})/i);
  return param ? param[1] : null;
}
