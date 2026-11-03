/**
 * Last time a signed-in coach/staff request reached this server process.
 * The percentile worker only polls the database while someone has used the
 * portal recently, so Neon can scale to zero when nobody is around.
 * Kept on globalThis because instrumentation and route bundles can load
 * separate module instances in the same process.
 */
const shared = globalThis as typeof globalThis & { coachLastActivityAt?: number };

export const COACH_IDLE_MS = 10 * 60_000;

export function touchCoachActivity() {
  shared.coachLastActivityAt = Date.now();
}

export function coachActiveWithin(ms = COACH_IDLE_MS) {
  const last = shared.coachLastActivityAt;
  return last !== undefined && Date.now() - last < ms;
}
