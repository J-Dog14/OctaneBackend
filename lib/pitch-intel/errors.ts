/**
 * Maps database errors to a message the dashboard can show. The common one
 * during setup: the pitch_intel tables haven't been created yet.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/42P01|relation "pitch_intel\.[a-z_]+" does not exist/.test(text)) {
    return "Pitch Intelligence tables are missing. Run `npm run pi:setup` once from the repo root, then reload.";
  }
  return fallback;
}
