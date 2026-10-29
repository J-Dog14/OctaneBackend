/**
 * Which warehouse athlete (analytics.d_athletes) each 8ctane app user is. Pure: appSync
 * reads the inputs and applies the decisions.
 *
 * Order, first hit wins:
 *   1. The hub already has this user linked (kept; a coach's manual link is never changed).
 *   2. d_athletes.app_db_uuid = the app user id.
 *   3. Same email, on exactly one athlete not linked to another app account.
 *   4. Same name (accents/punctuation/suffixes and nicknames ignored), exactly one such
 *      athlete, not linked to another app account, and no other app user with that name.
 *   5. A close name (nameScore ≥ NEAR_DUPLICATE_SCORE) → no athlete is created; the client
 *      is flagged for a coach to pick (could be a typo of an existing athlete).
 *   6. Otherwise a new d_athletes row is created (source_system 'octane_app').
 */

import { nameScore, normalizeName as looseName } from '@/lib/pitch-intel/match';
import { NEAR_DUPLICATE_SCORE } from './constants';
import { canonicalName } from './names';
import type { AppUser, LinkCandidate, LinkMethod } from './types';

export interface WarehouseAthlete {
  athleteUuid: string;
  name: string;
  normalizedName: string;
  email: string | null;
  appDbUuid: string | null;
}

export interface ExistingClient {
  id: string;
  appUserId: string | null;
  athleteUuid: string | null;
  linkMethod: LinkMethod | null;
}

export type LinkDecision =
  | { kind: 'keep'; athleteUuid: string | null }
  | { kind: 'link'; athleteUuid: string; method: Exclude<LinkMethod, 'created' | 'coach'>; setAppDbUuid: boolean }
  | { kind: 'create'; normalizedName: string }
  | { kind: 'review'; candidates: LinkCandidate[] };

/**
 * Same as uais/python/common/athlete_manager.normalize_name_for_matching, which is what
 * d_athletes.normalized_name (UNIQUE) holds: dates dropped, "LAST, FIRST" flipped, upper case.
 */
export function warehouseNormalizedName(raw: string): string {
  let name = raw.replace(/_/g, ' ');
  name = name.replace(/\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/g, '');
  name = name.replace(/\s*\d{4}[/-]\d{1,2}[/-]\d{1,2}/g, '');
  name = name.replace(/\s*\d{1,2}[/-]\d{1,2}(?![/-]\d)/g, '');
  name = name.replace(/\s*\d{4}/g, '');
  name = name.trim();
  if (name.includes(',')) {
    const parts = name.split(',');
    if (parts.length === 2) name = `${parts[1].trim()} ${parts[0].trim()}`;
  } else if (name.includes('.')) {
    const i = name.indexOf('.');
    const last = name.slice(0, i).trim();
    const first = name.slice(i + 1).trim();
    if (last && first) name = `${first} ${last}`;
  }
  return name.split(/\s+/).filter(Boolean).join(' ').toUpperCase();
}

/** Loose key for "same person": accents, punctuation, suffixes and first-name nicknames ignored. */
export function personKey(name: string): string {
  return canonicalName(looseName(name).toLowerCase());
}

export function decideLinks(users: AppUser[], athletes: WarehouseAthlete[], clients: ExistingClient[]): Map<string, LinkDecision> {
  const byUuid = new Map(athletes.map((a) => [a.athleteUuid, a]));
  const clientByUser = new Map(clients.filter((c) => c.appUserId).map((c) => [c.appUserId!, c]));
  // Athletes already claimed by a hub client can't be claimed by another one.
  const claimed = new Set(clients.map((c) => c.athleteUuid).filter((x): x is string => !!x));

  const byAppId = new Map<string, WarehouseAthlete[]>();
  const byEmail = new Map<string, WarehouseAthlete[]>();
  const byKey = new Map<string, WarehouseAthlete[]>();
  const add = (m: Map<string, WarehouseAthlete[]>, k: string | null, a: WarehouseAthlete) => {
    if (k) m.set(k, [...(m.get(k) ?? []), a]);
  };
  for (const a of athletes) {
    add(byAppId, a.appDbUuid, a);
    add(byEmail, a.email?.trim().toLowerCase() || null, a);
    add(byKey, personKey(a.name), a);
  }
  const usersPerKey = new Map<string, number>();
  for (const u of users) usersPerKey.set(personKey(u.name), (usersPerKey.get(personKey(u.name)) ?? 0) + 1);
  const normalizedTaken = new Set(athletes.map((a) => a.normalizedName));

  const out = new Map<string, LinkDecision>();
  const claim = (u: AppUser, d: LinkDecision) => {
    if (d.kind === 'link') claimed.add(d.athleteUuid);
    out.set(u.id, d);
  };
  const free = (a: WarehouseAthlete, u: AppUser) => !claimed.has(a.athleteUuid) && (!a.appDbUuid || a.appDbUuid === u.id);

  // Pass 1: keep existing links and take the strong (id / email) matches before any name matching.
  const pending: AppUser[] = [];
  for (const u of users) {
    const existing = clientByUser.get(u.id);
    if (existing?.athleteUuid && byUuid.has(existing.athleteUuid)) {
      out.set(u.id, { kind: 'keep', athleteUuid: existing.athleteUuid });
      continue;
    }
    if (existing?.linkMethod === 'coach') {
      out.set(u.id, { kind: 'keep', athleteUuid: null });
      continue;
    }
    const byId = (byAppId.get(u.id) ?? []).filter((a) => !claimed.has(a.athleteUuid));
    if (byId.length) {
      claim(u, { kind: 'link', athleteUuid: byId[0].athleteUuid, method: 'app_db_uuid', setAppDbUuid: false });
      continue;
    }
    const email = u.email?.trim().toLowerCase();
    const sameEmail = email ? (byEmail.get(email) ?? []).filter((a) => free(a, u)) : [];
    if (sameEmail.length === 1) {
      claim(u, { kind: 'link', athleteUuid: sameEmail[0].athleteUuid, method: 'email', setAppDbUuid: !sameEmail[0].appDbUuid });
      continue;
    }
    pending.push(u);
  }

  // Pass 2: names.
  for (const u of pending) {
    const key = personKey(u.name);
    const sameName = (byKey.get(key) ?? []).filter((a) => free(a, u));
    if (key && sameName.length === 1 && usersPerKey.get(key) === 1) {
      claim(u, { kind: 'link', athleteUuid: sameName[0].athleteUuid, method: 'name', setAppDbUuid: !sameName[0].appDbUuid });
      continue;
    }
    const candidates = athletes
      .filter((a) => !claimed.has(a.athleteUuid))
      .map((a) => ({ athleteUuid: a.athleteUuid, name: a.name, score: Math.max(nameScore(u.name, a.name), personKey(a.name) === key ? 100 : 0) }))
      .filter((c) => c.score >= NEAR_DUPLICATE_SCORE)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 5);
    const normalizedName = warehouseNormalizedName(u.name);
    if (candidates.length || !normalizedName || normalizedTaken.has(normalizedName)) {
      out.set(u.id, { kind: 'review', candidates });
      continue;
    }
    normalizedTaken.add(normalizedName);
    out.set(u.id, { kind: 'create', normalizedName });
  }
  return out;
}
