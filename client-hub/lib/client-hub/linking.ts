// Linking hub clients to 8ctane athletes, and seeding the hub from 8ctane's remote programs
// (the replacement for the old Google Sheets import).
import { canonicalName, findByName } from './names';
import type { ClientFacts, HubAthlete, ProgramType } from './types';

const coachedBy = (a: HubAthlete, octaneUserUuid: string | null) =>
  !!octaneUserUuid && a.programs.some((p) => p.coaches.some((c) => c.userUuid === octaneUserUuid));

/** Rank candidates: coached by this coach first, then most active programs. */
export function rankAthletes(candidates: HubAthlete[], octaneUserUuid: string | null): HubAthlete[] {
  return [...candidates].sort(
    (x, y) =>
      Number(coachedBy(y, octaneUserUuid)) - Number(coachedBy(x, octaneUserUuid)) ||
      y.programs.length - x.programs.length,
  );
}

/** Picker suggestions for a client (exact or near-miss name matches), best first. */
export function suggestAthletes(name: string, athletes: HubAthlete[], octaneUserUuid: string | null): HubAthlete[] {
  return rankAthletes(findByName(name, athletes, (a) => a.name), octaneUserUuid);
}

/**
 * Auto-link only on an exact canonical name match, and only when one athlete clearly wins.
 * Skips linked clients, ended clients, and clients a coach deliberately unlinked.
 */
export function chooseAutoLink(c: ClientFacts, athletes: HubAthlete[], ownerOctaneUserUuid: string | null): HubAthlete | null {
  if (c.octaneAthleteUuid || c.status === 'ENDED' || c.linkSource === 'DISMISSED') return null;
  const target = canonicalName(c.name);
  const exact = athletes.filter((a) => canonicalName(a.name) === target);
  if (!exact.length) return null;
  const [best, runnerUp] = rankAthletes(exact, ownerOctaneUserUuid);
  if (
    runnerUp &&
    coachedBy(runnerUp, ownerOctaneUserUuid) === coachedBy(best, ownerOctaneUserUuid) &&
    runnerUp.programs.length === best.programs.length
  ) {
    return null; // a tie — leave it for a coach to pick
  }
  return best;
}

export interface SeedCandidate {
  name: string;
  programType: ProgramType;
  coachName: string | null;
  ownerClerkUserId: string | null;
  octaneAthleteUuid: string;
  octaneName: string;
}

/**
 * Every athlete with an active REMOTE or HYBRID program who isn't in the hub yet (by athlete UUID or by name).
 * Owner = the first program coach who has linked themselves in HubCoach.
 */
export function planSeed(
  athletes: HubAthlete[],
  existing: ClientFacts[],
  coaches: { clerkUserId: string; octaneUserUuid: string }[],
): SeedCandidate[] {
  const linked = new Set(existing.map((c) => c.octaneAthleteUuid).filter(Boolean));
  const names = new Set(existing.map((c) => canonicalName(c.name)));
  const clerkByOctane = new Map(coaches.map((c) => [c.octaneUserUuid, c.clerkUserId]));

  const out: SeedCandidate[] = [];
  for (const a of athletes) {
    const program = a.programs.find((p) => p.type === 'REMOTE' || p.type === 'HYBRID');
    if (!program || linked.has(a.uuid) || names.has(canonicalName(a.name))) continue;
    const owner = program.coaches.map((c) => (c.userUuid ? clerkByOctane.get(c.userUuid) : undefined)).find(Boolean) ?? null;
    out.push({
      name: a.name.trim(),
      programType: program.type === 'HYBRID' ? 'HYBRID' : 'REMOTE',
      coachName: program.coaches.map((c) => c.name).join(', ') || null,
      ownerClerkUserId: owner,
      octaneAthleteUuid: a.uuid,
      octaneName: a.name,
    });
    names.add(canonicalName(a.name));
  }
  return out;
}
