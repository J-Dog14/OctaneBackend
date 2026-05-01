/**
 * Shared helpers for Octane payload builders (pitching, hitting, mobility, etc.).
 */

export function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  // Prisma Decimal / Decimal.js-like
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyVal = value as any;
  if (typeof anyVal.toNumber === "function") return anyVal.toNumber();
  if (typeof anyVal.toString === "function") {
    const num = Number(anyVal.toString());
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

export function deriveLevelFromAthlete(athlete: { age_group: string | null }): string {
  const raw = athlete.age_group?.trim();
  if (!raw) return "PRO";
  const upper = raw.toUpperCase().replace(/\s+/g, "_");
  if (upper === "YOUTH") return "BASEBALL_CLUB";
  return upper;
}
