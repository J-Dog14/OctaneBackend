import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { populationDefinitions, invalidatePopulationRead, clearPopulationReads, populationStatus } from "./populations";
import { clearCoachDataCache } from "@/lib/coach/cache";

let loaded: Promise<unknown> | undefined;
export function loadPopulationDefinitions() {
  return loaded ??= Promise.all([
    import("@/lib/athlete-tracking/percentiles"),
    import("@/lib/coach/biomech/report"),
    import("@/lib/coach/athleticScreen/report"),
    import("@/lib/coach/mobility"),
    import("@/lib/coach/proSup"),
  ]).catch((error) => { loaded = undefined; throw error; });
}

export async function ensurePopulationJobs() {
  await loadPopulationDefinitions();
  const keys = [...populationDefinitions().keys()];
  await prisma.$executeRaw`
    INSERT INTO public.coach_population_snapshots (key)
    SELECT unnest(${keys}::text[]) ON CONFLICT (key) DO NOTHING
  `;
}

/** Claim with SKIP LOCKED; lease tokens fence off expired/restarted workers. */
export async function claimPopulationJob(keys: string[], token: string) {
  const rows = await prisma.$queryRaw<Array<{ key: string; revision: string }>>`
    WITH candidate AS (
      SELECT key FROM public.coach_population_snapshots
      WHERE key = ANY(${keys}::text[])
        AND next_attempt_at <= now()
        AND (requested_version > completed_version OR refreshed_at < now() - interval '1 day')
        AND (lease_until IS NULL OR lease_until < now())
      ORDER BY (payload IS NULL) DESC, next_attempt_at, key
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE public.coach_population_snapshots s
       SET lease_token = ${token}, lease_until = now() + interval '15 minutes'
      FROM candidate c WHERE s.key = c.key
    RETURNING s.key, s.requested_version::text AS revision
  `;
  return rows[0] ?? null;
}

export async function publishPopulation(key: string, token: string, revision: string, payload: unknown) {
  const updated = await prisma.$executeRaw`
    UPDATE public.coach_population_snapshots
       SET payload = ${JSON.stringify(payload)}::jsonb,
           completed_version = ${revision}::bigint, refreshed_at = now(),
           lease_token = NULL, lease_until = NULL, last_error = NULL, failure_count = 0
     WHERE key = ${key} AND lease_token = ${token}
  `;
  if (updated) {
    invalidatePopulationRead(key);
    clearCoachDataCache();
  }
  return updated > 0;
}

export async function failPopulation(key: string, token: string, error: unknown) {
  // Do not expose source data, SQL or connection credentials through status.
  const reason = error instanceof Error ? error.name : "PopulationBuildError";
  await prisma.$executeRaw`
    UPDATE public.coach_population_snapshots
       SET lease_token = NULL, lease_until = NULL, last_error = ${reason},
           failure_count = failure_count + 1,
           next_attempt_at = now() + LEAST(300, power(2, LEAST(failure_count + 1, 8))) * interval '1 second'
     WHERE key = ${key} AND lease_token = ${token}
  `;
}

export async function runPopulationRefreshes({ maxJobs = 20, maxDurationMs = 240_000 } = {}) {
  await ensurePopulationJobs();
  const definitions = populationDefinitions();
  const started = Date.now();
  const result = { completed: 0, failed: 0, superseded: 0 };
  for (let i = 0; i < maxJobs && Date.now() - started < maxDurationMs; i++) {
    const token = randomUUID();
    const job = await claimPopulationJob([...definitions.keys()], token);
    if (!job) break;
    const heartbeat = setInterval(() => {
      void prisma.$executeRaw`
        UPDATE public.coach_population_snapshots SET lease_until = now() + interval '15 minutes'
        WHERE key = ${job.key} AND lease_token = ${token}
      `.catch(() => { /* Expiration and the fencing token handle a lost lease. */ });
    }, 30_000);
    heartbeat.unref();
    try {
      const payload = await definitions.get(job.key)!.build();
      if (await publishPopulation(job.key, token, job.revision, payload)) result.completed++;
      else result.superseded++;
    } catch (error) {
      await failPopulation(job.key, token, error);
      result.failed++;
    } finally {
      clearInterval(heartbeat);
    }
  }
  return result;
}

/** For the persistent Railway/Node server; scheduled endpoint also drains jobs. */
export function startPopulationWorker() {
  const processState = globalThis as typeof globalThis & { coachPopulationWorker?: ReturnType<typeof setInterval> };
  if (processState.coachPopulationWorker) return;
  let running = false;
  let warned = false;
  let version: string | undefined;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runPopulationRefreshes();
      const status = await populationStatus();
      if (version !== status.version) {
        clearPopulationReads();
        clearCoachDataCache();
        version = status.version;
      }
      warned = false;
    } catch {
      if (!warned) console.warn("Population worker unavailable. Apply the coach population snapshot migration and check database connectivity.");
      warned = true;
    } finally {
      running = false;
    }
  };
  processState.coachPopulationWorker = setInterval(() => { void tick(); }, 5_000);
  processState.coachPopulationWorker.unref();
  void tick();
}
