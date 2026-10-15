const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

// Use the installed TypeScript compiler; no extra test runner or database needed.
const root = path.resolve(__dirname, "..");
const modules = new Map();
function loadTs(relative, overrides = {}) {
  const filename = path.resolve(root, relative);
  const isolated = Object.keys(overrides).length > 0;
  if (!isolated && modules.has(filename)) return modules.get(filename).exports;
  const compiled = new Module(filename, module);
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  if (!isolated) modules.set(filename, compiled);
  const originalRequire = compiled.require.bind(compiled);
  compiled.require = (id) => {
    if (id in overrides) return overrides[id];
    if (id.startsWith("@/")) return loadTs(`${id.slice(2)}.ts`);
    if (id.startsWith(".") && fs.existsSync(path.resolve(path.dirname(filename), `${id}.ts`))) {
      return loadTs(path.resolve(path.dirname(filename), `${id}.ts`));
    }
    return originalRequire(id);
  };
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  });
  compiled._compile(outputText, filename);
  return compiled.exports;
}

const { createAsyncTtlCache } = loadTs("lib/cache/asyncTtlCache.ts");
const { cachedCoachData } = loadTs("lib/coach/cache.ts");
const { createCoachFetcher } = loadTs("app/coach/_components/fetcher.ts");
const { athleteWarmKeys, warmAthleteData, latestPitchKey } = loadTs("app/coach/_components/prefetch.ts");
const cacheOptions = { ttlMs: 100, maxEntries: 2, maxBytes: 1000 };
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test("concurrent misses share work; TTL starts when the response completes", async () => {
  let time = 0;
  let calls = 0;
  const gate = deferred();
  const cache = createAsyncTtlCache({ ...cacheOptions, now: () => time });
  const load = () => { calls++; return gate.promise; };
  const first = cache.getOrLoad("a", load);
  const second = cache.getOrLoad("a", load);
  await Promise.resolve();
  assert.equal(calls, 1);
  time = 500;
  gate.resolve({ version: 1 });
  assert.deepEqual(await first, await second);
  time = 599;
  await cache.getOrLoad("a", load);
  assert.equal(calls, 1);
  time = 600;
  await cache.getOrLoad("a", load);
  assert.equal(calls, 2);
});

test("failed requests are retryable and distinct selections have distinct entries", async () => {
  const cache = createAsyncTtlCache(cacheOptions);
  await assert.rejects(cache.getOrLoad("a/latest", async () => { throw new Error("offline"); }), /offline/);
  assert.equal(await cache.getOrLoad("a/latest", async () => 1), 1);
  assert.equal(await cache.getOrLoad("a/date", async () => 2), 2);
  assert.equal(await cache.getOrLoad("a/latest", async () => 3), 1);
});

test("entry and byte limits evict old data, and oversized results are not retained", async () => {
  const cache = createAsyncTtlCache(cacheOptions);
  for (const key of ["a", "b", "a", "c"]) await cache.getOrLoad(key, async () => key);
  assert.equal(await cache.getOrLoad("a", async () => "new-a"), "a");
  assert.equal(await cache.getOrLoad("b", async () => "new-b"), "new-b");
  const small = createAsyncTtlCache({ ...cacheOptions, maxBytes: 6 });
  await small.getOrLoad("a", async () => "abc");
  await small.getOrLoad("b", async () => "def");
  assert.equal(await small.getOrLoad("a", async () => "new"), "new");
  await small.getOrLoad("huge", async () => "too large");
  assert.equal(await small.getOrLoad("huge", async () => "retry"), "retry");
});

test("refresh/clear during an old request prevents the old result from replacing fresh data", async () => {
  for (const reset of ["invalidate", "clear"]) {
    const cache = createAsyncTtlCache(cacheOptions);
    const gate = deferred();
    const old = cache.getOrLoad("a", () => gate.promise);
    await Promise.resolve();
    cache[reset]("a");
    assert.equal(await cache.getOrLoad("a", async () => "fresh"), "fresh");
    gate.resolve("old");
    assert.equal(await old, "old");
    assert.equal(await cache.getOrLoad("a", async () => "miss"), "fresh");
  }
});

test("server refresh bypasses recent data; dates and athletes remain isolated", async () => {
  const normal = new Request("http://localhost/api/coach");
  const refresh = new Request(normal, { headers: { "x-coach-refresh": "1" } });
  let count = 0;
  const load = async () => ++count;
  assert.equal(await cachedCoachData(normal, ["test", "a", null], load), 1);
  assert.equal(await cachedCoachData(normal, ["test", "a", null], load), 1);
  assert.equal(await cachedCoachData(normal, ["test", "b", null], load), 2);
  assert.equal(await cachedCoachData(normal, ["test", "a", "2026-10-14"], load), 3);
  assert.equal(await cachedCoachData(refresh, ["test", "a", null], load), 4);
});

test("browser fetchers deduplicate, isolate accounts, and request a server bypass on refresh", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return Response.json({ version: calls.length });
  });
  const coachA = createCoachFetcher();
  const coachB = createCoachFetcher();
  const [a, b] = await Promise.all([coachA("/athlete/a"), coachA("/athlete/a")]);
  assert.deepEqual(a, b);
  assert.equal(calls.length, 1);
  assert.deepEqual(await coachB("/athlete/a"), { version: 2 });
  assert.deepEqual(await coachA("/athlete/a", { refresh: true }), { version: 3 });
  assert.equal(calls[2].options.headers["x-coach-refresh"], "1");
  assert.equal(calls[2].options.cache, "no-store");
  coachA.setPopulationVersion("new-generation");
  assert.deepEqual(await coachA("/athlete/a"), { version: 4 });
  assert.equal(calls[3].options.headers["x-coach-population-version"], "new-generation");
});

test("browser authorization failures are not reused on retry", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return calls === 1 ? Response.json({ error: "Forbidden" }, { status: 403 }) : Response.json({ allowed: true });
  });
  const fetcher = createCoachFetcher();
  await assert.rejects(fetcher("/athlete/a"), /Forbidden/);
  assert.deepEqual(await fetcher("/athlete/a"), { allowed: true });
});

test("athlete route runs access checks even when the report is cached", async () => {
  let checks = 0;
  let builds = 0;
  let allowed = true;
  const { GET } = loadTs("app/api/coach/athletes/[uuid]/summary/route.ts", {
    "@/lib/coach/access": { requireCoachForAthlete: async () => {
      checks++;
      return allowed ? null : Response.json({ error: "Forbidden" }, { status: 403 });
    } },
    "@/lib/coach/summary": { getCoachAthleteSummary: async () => { builds++; return { name: "test" }; } },
    "@/lib/responses": {
      success: (data) => Response.json(data),
      notFound: (error) => Response.json({ error }, { status: 404 }),
      internalError: (error) => Response.json({ error }, { status: 500 }),
    },
  });
  const request = new Request("http://localhost/api/coach/athletes/auth-test-a/summary");
  const params = { params: Promise.resolve({ uuid: "auth-test-a" }) };
  assert.equal((await GET(request, params)).status, 200);
  assert.equal((await GET(request, params)).status, 200);
  allowed = false;
  assert.equal((await GET(request, params)).status, 403);
  assert.equal(checks, 3);
  assert.equal(builds, 1);
});

function summary(tabs = {}) {
  return { athlete: { athleteUuid: "a" }, tabs, trackingDomains: tabs.biomechanics ? ["pitching"] : [] };
}

test("warming respects available domains and limits background concurrency to two", async () => {
  const s = summary({ pitching: true, readiness: true, biomechanics: true, assessments: true, mobility: true, prosup: true });
  let running = 0;
  let max = 0;
  const primary = ["tracking", "pitching", "readiness"].map((suffix) => `/api/coach/athletes/a/${suffix}`);
  const seen = [];
  await warmAthleteData(s, async (key) => {
    seen.push(key);
    if (primary.includes(key)) return {};
    running++;
    max = Math.max(max, running);
    await new Promise((r) => setImmediate(r));
    running--;
    return key.endsWith("/sessions") ? { sessions: [{ key: "sv:123" }] } : {};
  }, () => false);
  assert.equal(max, 2);
  for (const key of athleteWarmKeys(s)) assert.ok(seen.includes(key), key);
  assert.ok(seen.includes("/api/coach/athletes/a/pitches?session=sv%3A123"));
  assert.deepEqual(athleteWarmKeys(summary()), ["/api/coach/athletes/a/tracking"]);
  assert.equal(latestPitchKey("/pitches/sessions", { sessions: [] }), null);
});

test("navigation stops background scheduling and a failed preload does not block other tabs", async () => {
  const s = summary({ mobility: true, prosup: true, curveball: true });
  const cancelled = [];
  await warmAthleteData(s, async (key) => { cancelled.push(key); }, () => true);
  assert.deepEqual(cancelled, ["/api/coach/athletes/a/tracking"]);
  const seen = [];
  await warmAthleteData(s, async (key) => {
    seen.push(key);
    if (key.endsWith("/mobility")) throw new Error("failed");
  }, () => false);
  assert.ok(seen.some((key) => key.endsWith("/assessments")));
});
