/** Bounded, in-memory cache. Concurrent misses share work; failures are never cached. */
export function createAsyncTtlCache({
  ttlMs,
  maxEntries,
  maxBytes,
  now = Date.now,
}: { ttlMs: number; maxEntries: number; maxBytes: number; now?: () => number }) {
  const values = new Map<string, { value: unknown; expiresAt: number; bytes: number }>();
  const pending = new Map<string, Promise<unknown>>();
  let bytes = 0;

  function invalidate(key: string) {
    const entry = values.get(key);
    if (entry) bytes -= entry.bytes;
    values.delete(key);
    // A superseded request may finish, but must not repopulate the cache.
    pending.delete(key);
  }

  async function getOrLoad<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = values.get(key);
    if (hit && hit.expiresAt > now()) {
      values.delete(key);
      values.set(key, hit);
      return hit.value as T;
    }
    if (hit) invalidate(key);
    const running = pending.get(key);
    if (running) return running as Promise<T>;

    const task = Promise.resolve().then(load).then((value) => {
      if (pending.get(key) !== task) return value;
      // Payloads are JSON data; cap retained memory as well as entry count.
      const size = new TextEncoder().encode(JSON.stringify(value) ?? "null").byteLength;
      if (size <= maxBytes) {
        for (const [oldKey, entry] of values) {
          if (entry.expiresAt <= now()) invalidate(oldKey);
        }
        while (values.size && (values.size >= maxEntries || bytes + size > maxBytes)) {
          invalidate(values.keys().next().value!);
        }
        values.set(key, { value, expiresAt: now() + ttlMs, bytes: size });
        bytes += size;
      }
      return value;
    }).finally(() => {
      if (pending.get(key) === task) pending.delete(key);
    });
    pending.set(key, task);
    return task;
  }

  return {
    getOrLoad,
    invalidate,
    clear() {
      values.clear();
      pending.clear();
      bytes = 0;
    },
  };
}
