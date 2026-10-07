/**
 * Fuzzy name matching against analytics.d_athletes, so a Savant player can be
 * linked to the right athlete even with typos or accents. Runs in code (a few
 * thousand names compare in milliseconds) rather than with a Postgres extension.
 */

const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V"]);

/** Same convention as d_athletes.normalized_name: FIRST LAST, uppercase, no accents or punctuation. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !SUFFIXES.has(t))
    .join(" ");
}

/** Jaro-Winkler similarity, 0..1. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(i + window + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = true;
      bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

function sortTokens(s: string): string {
  return s.split(" ").sort().join(" ");
}

/** Similarity of two names, 0..100. Handles typos, accents and swapped first/last order. */
export function nameScore(query: string, candidate: string): number {
  const a = normalizeName(query);
  const b = normalizeName(candidate);
  if (!a || !b) return 0;
  const direct = jaroWinkler(a, b);
  const sorted = jaroWinkler(sortTokens(a), sortTokens(b));
  // Exact last-name match with a matching first initial is a strong signal (e.g. "Jake" vs "Jacob").
  const [af, ...ar] = a.split(" ");
  const [bf, ...br] = b.split(" ");
  const sameLast = ar.length > 0 && ar.join(" ") === br.join(" ");
  const initialBonus = sameLast && af?.[0] === bf?.[0] ? 0.88 : 0;
  return Math.round(Math.max(direct, sorted, initialBonus) * 100);
}

export interface AthleteCandidate {
  athlete_uuid: string;
  name: string;
  normalized_name: string;
  age_group: string | null;
  date_of_birth: string | null;
}

export interface AthleteMatch extends AthleteCandidate {
  score: number;
}

export function rankAthletes(query: string, athletes: AthleteCandidate[], limit = 5): AthleteMatch[] {
  return athletes
    .map((a) => ({ ...a, score: Math.max(nameScore(query, a.name), nameScore(query, a.normalized_name)) }))
    .sort((x, y) => y.score - x.score || x.name.localeCompare(y.name))
    .slice(0, limit);
}
