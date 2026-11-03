import { prisma } from "@/lib/db/prisma";
import { createHash } from "node:crypto";
import { createAsyncTtlCache } from "@/lib/cache/asyncTtlCache";

type Definition = { build: () => Promise<unknown>; empty: () => unknown };
type PopulationState = {
  definitions: Map<string, Definition>;
  reads: ReturnType<typeof createAsyncTtlCache>;
};

// Instrumentation and route bundles share a process, but may have separate
// module instances. Keep definitions and short read caches on globalThis.
const shared = globalThis as typeof globalThis & { coachPopulations?: PopulationState };
const state = shared.coachPopulations ??= {
  definitions: new Map(),
  reads: createAsyncTtlCache({ ttlMs: 10_000, maxEntries: 64, maxBytes: 64 * 1024 * 1024 }),
};
// Every open coach tab polls status; share one query across them.
const statusCache = createAsyncTtlCache({ ttlMs: 10_000, maxEntries: 1, maxBytes: 64 * 1024 });

/** Register expensive work for the worker; the returned reader NEVER builds it. */
export function definePopulation<T>(key: string, build: () => Promise<T>, empty: () => T): () => Promise<T> {
  state.definitions.set(key, { build, empty });
  return async () => state.reads.getOrLoad(key, async () => {
    const rows = await prisma.$queryRaw<Array<{ payload: T | null }>>`
      SELECT payload FROM public.coach_population_snapshots WHERE key = ${key}
    `;
    // An initial backfill is queued by setup/startup. Until it completes, show
    // raw athlete metrics with unavailable percentiles rather than blocking.
    return rows[0]?.payload ?? empty();
  });
}

export function populationDefinitions() {
  return state.definitions;
}

export function invalidatePopulationRead(key: string) {
  state.reads.invalidate(key);
}

export function clearPopulationReads() {
  state.reads.clear();
}

/** Cached status for the polling endpoint (the worker reads it uncached). */
export function cachedPopulationStatus() {
  return statusCache.getOrLoad("status", populationStatus);
}

export async function populationStatus() {
  const rows = await prisma.$queryRaw<Array<{
    key: string; version: string; refreshed_at: string | null; pending: boolean; ready: boolean; failed: boolean;
  }>>`
    SELECT key, completed_version::text AS version, refreshed_at::text AS refreshed_at,
           requested_version > completed_version AS pending,
           payload IS NOT NULL AS ready, last_error IS NOT NULL AS failed
      FROM public.coach_population_snapshots ORDER BY key
  `;
  return {
    version: createHash("sha256").update(JSON.stringify(rows.map((r) => [r.key, r.version, r.refreshed_at]))).digest("hex"),
    pending: rows.filter((r) => r.pending).length,
    ready: rows.filter((r) => r.ready).length,
    failed: rows.filter((r) => r.failed).length,
  };
}
