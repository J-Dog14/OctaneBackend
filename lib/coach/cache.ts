import { createAsyncTtlCache } from "@/lib/cache/asyncTtlCache";

// Shared by requests handled by this server process. Authentication/roster
// checks stay in the routes and run BEFORE consulting this data cache.
const shared = globalThis as typeof globalThis & {
  coachResponseCache?: ReturnType<typeof createAsyncTtlCache>;
  coachPopulationVersion?: string;
};
const dataCache = shared.coachResponseCache ??= createAsyncTtlCache({ ttlMs: 60_000, maxEntries: 250, maxBytes: 32 * 1024 * 1024 });

export function clearCoachDataCache() {
  dataCache.clear();
}

export async function cachedCoachData<T>(request: Request, key: unknown[], load: () => Promise<T>): Promise<T> {
  const version = request.headers.get("x-coach-population-version");
  if (version && shared.coachPopulationVersion !== version) {
    // A browser may hit a different server from the worker/status request.
    // Its generation makes that server discard old population/response reads.
    const { clearPopulationReads } = await import("@/lib/percentiles/populations");
    clearPopulationReads();
    dataCache.clear();
    shared.coachPopulationVersion = version;
  }
  const serialized = JSON.stringify([...key, version]);
  if (request.headers.get("x-coach-refresh") === "1") dataCache.invalidate(serialized);
  return dataCache.getOrLoad(serialized, load);
}
