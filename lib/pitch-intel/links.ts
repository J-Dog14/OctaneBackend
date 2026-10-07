/**
 * Linking flow:
 *   1. findSavantPlayers(name | MLB ID | Savant URL)  -> pick the Savant player
 *   2. suggestAthletes(savantName)                    -> pick the d_athletes record
 *   3. createLink(...)                                -> then backfill() and nightly from there
 *
 * This module never creates athletes; a pitcher with no d_athletes record is
 * added through the existing Athletes flow first.
 */

import { getPlayerById, parseMlbamId, searchSavantPlayers, type SavantPlayer } from "./savant/client";
import { rankAthletes, type AthleteMatch } from "./match";
import {
  getAthleteName,
  getLink,
  getLinkBySourceId,
  insertLink,
  linksForAthletes,
  loadAthleteCandidates,
  type Link,
} from "./db";
import { defaultBackfillFrom } from "./pull";
import { EARLIEST_SAVANT_SEASON } from "./config";

export class LinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkError";
  }
}

/** Step 1: a name searches Savant; a pasted MLB ID or Savant URL looks that player up directly. */
export async function findSavantPlayers(input: string): Promise<SavantPlayer[]> {
  const id = parseMlbamId(input);
  if (id) {
    const player = await getPlayerById(id);
    return player ? [player] : [];
  }
  return searchSavantPlayers(input);
}

export interface AthleteSuggestion extends AthleteMatch {
  /** Set when this athlete already has a Savant link. */
  linked_to: { source_player_name: string; source_player_id: string } | null;
}

/** Step 2: closest d_athletes names to the Savant player's name (typo-tolerant). */
export async function suggestAthletes(name: string, limit = 5): Promise<AthleteSuggestion[]> {
  const ranked = rankAthletes(name, await loadAthleteCandidates(), limit);
  const existing = await linksForAthletes(ranked.map((r) => r.athlete_uuid));
  const byAthlete = new Map(existing.map((e) => [e.athlete_uuid, e]));
  return ranked.map((r) => {
    const link = byAthlete.get(r.athlete_uuid);
    return { ...r, linked_to: link ? { source_player_name: link.source_player_name, source_player_id: link.source_player_id } : null };
  });
}

export interface CreateLinkInput {
  athleteUuid: string;
  player: Pick<SavantPlayer, "id" | "name" | "throws" | "league" | "isMlb">;
  backfillFrom?: number;
  linkedBy?: string | null;
}

/** Step 3: saves the link. Throws LinkError with a readable message if it conflicts. */
export async function createLink(input: CreateLinkInput): Promise<Link> {
  const athleteName = await getAthleteName(input.athleteUuid);
  if (!athleteName) throw new LinkError("That athlete doesn't exist in the database.");

  if (!/^\d{4,8}$/.test(input.player.id)) throw new LinkError("Savant player ID must be a number.");

  const existing = await getLinkBySourceId("savant", input.player.id);
  if (existing) {
    throw new LinkError(`${input.player.name} (${input.player.id}) is already linked to ${existing.athlete_name}.`);
  }
  const athleteLinks = await linksForAthletes([input.athleteUuid]);
  if (athleteLinks.length) {
    const l = athleteLinks[0];
    throw new LinkError(`${athleteName} is already linked to ${l.source_player_name} (${l.source_player_id}).`);
  }

  const thisYear = new Date().getFullYear();
  const backfillFrom = Math.min(thisYear, Math.max(EARLIEST_SAVANT_SEASON, input.backfillFrom ?? defaultBackfillFrom()));
  // Savant sends league as "" for some minor leaguers; store blank as null.
  const league = input.player.league?.trim() || (input.player.isMlb ? "MLB" : null);

  const id = await insertLink({
    athleteUuid: input.athleteUuid,
    source: "savant",
    sourcePlayerId: input.player.id,
    sourcePlayerName: input.player.name,
    throws: input.player.throws,
    level: input.player.isMlb ? "MLB" : "MiLB",
    league,
    backfillFrom,
    linkedBy: input.linkedBy ?? null,
  });
  const link = await getLink(id);
  if (!link) throw new LinkError("Link was saved but could not be read back.");
  return link;
}
