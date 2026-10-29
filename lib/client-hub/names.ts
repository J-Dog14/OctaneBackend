// Name matching ported from the original hub. Used to suggest and auto-link 8ctane athletes.

const NICKNAMES: Record<string, string> = {
  will: 'william', bill: 'william', chris: 'christopher', josh: 'joshua', jake: 'jacob', zach: 'zachary',
  alex: 'alexander', ben: 'benjamin', matt: 'matthew', mike: 'michael', nate: 'nathan', tom: 'thomas',
  andy: 'andrew', drew: 'andrew', jeff: 'jeffrey', jeffery: 'jeffrey', sam: 'samuel', nick: 'nicholas',
  tony: 'anthony', nomi: 'noumaan', griff: 'griffin',
};

/** Lowercase, drop "(…)" and "**…**" notes, anything after "paused"/"resumed", "data link", and non-letters. */
export function normalizeName(raw: string | null | undefined): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/\(.*?\)|\*+[^*]*\*+/g, ' ')
    .replace(/\b(paused?|resumed)\b.*$/, '')
    .replace(/\bdata link\b/g, ' ')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** normalizeName, then expand a first-name nickname (only when there's a last name too). */
export function canonicalName(raw: string | null | undefined): string {
  const parts = normalizeName(raw).split(' ');
  if (parts.length > 1) parts[0] = NICKNAMES[parts[0]] ?? parts[0];
  return parts.join(' ');
}

export function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = above;
    }
  }
  return prev[b.length];
}

/**
 * Exact canonical match first. If none and the name is 8+ characters, allow up to 2 edits
 * (with lengths within 2 of each other) to catch typos like "Jaslina" / "Jasline".
 */
export function findByName<T>(name: string, list: readonly T[], getName: (item: T) => string): T[] {
  const target = canonicalName(name);
  if (!target) return [];
  const exact = list.filter((item) => canonicalName(getName(item)) === target);
  if (exact.length || target.length < 8) return exact;
  return list.filter((item) => {
    const candidate = canonicalName(getName(item));
    return Math.abs(candidate.length - target.length) <= 2 && levenshtein(candidate, target) <= 2;
  });
}
