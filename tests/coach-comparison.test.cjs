const assert = require("node:assert/strict");
const { test } = require("node:test");
const { compile } = require("./helpers/compile-ts.cjs");
const comparison = compile("lib/coach/comparison.ts");
const { loadComparisonBundles } = compile("app/coach/_components/compareData.ts");

function summary(uuid = "a", pitching = true) {
  return {
    athlete: { athleteUuid: uuid }, sources: pitching ? [{ id: "trackman", sessions: 1 }] : [],
    trackingDomains: ["pitching", "hitting", "armAction", "athleticScreen", "mobility", "proteus"],
    tabs: { overview: true, pitching: true, biomechanics: true, assessments: true, mobility: true, proteus: true, prosup: true, curveball: true, readiness: true },
  };
}

test("pitching eligibility requires actual pitch sessions rather than a source link or 3D flag", () => {
  assert.equal(comparison.hasComparisonData(summary("a", false), "pitching"), false);
  assert.equal(comparison.hasComparisonData(summary(), "pitching"), true);
});

test("each tab keeps its own selection; sharing is explicit and legacy links still work", () => {
  const params = new URLSearchParams("tab=pitching&vs_pitching=b&vs_biomechanics=c&other=keep");
  assert.deepEqual(comparison.selectedComparisonIds(params, "pitching", "a"), ["b"]);
  assert.deepEqual(comparison.selectedComparisonIds(params, "biomechanics", "a"), ["c"]);
  assert.deepEqual(comparison.selectedComparisonIds(params, "mobility", "a"), []);
  const shared = comparison.applyComparisonToAll(params, ["b"]);
  assert.equal(shared.get("tab"), "pitching");
  assert.equal(shared.get("other"), "keep");
  assert.deepEqual(comparison.selectedComparisonIds(shared, "mobility", "a"), ["b"]);
  assert.equal(shared.has("vs_biomechanics"), false);
  shared.set("vs_mobility", "");
  assert.deepEqual(comparison.selectedComparisonIds(shared, "mobility", "a"), []);
  assert.deepEqual(comparison.selectedComparisonIds(new URLSearchParams("vs=b,c"), "compare", "a"), ["b", "c"]);
  assert.deepEqual(comparison.parseComparisonIds("a,b,b,bad/id,c,d,e", "a"), ["b", "c", "d"]);
});

test("single-area comparisons request only that area's payload", async () => {
  const cases = {
    pitching: ["pitching"],
    biomechanics: ["tracking?domains=pitching%2Chitting%2CarmAction"],
    assessments: ["tracking?domains=athleticScreen"],
    mobility: ["tracking?domains=mobility"],
    proteus: ["tracking?domains=proteus"],
    readiness: ["readiness"],
    prosup: ["assessments?kind=prosup"],
    curveball: ["assessments?kind=curveball"],
  };
  for (const [scope, expected] of Object.entries(cases)) {
    const calls = [];
    await loadComparisonBundles(async (url) => {
      calls.push(url.replace("/api/coach/athletes/a/", ""));
      return url.endsWith("/summary") ? summary() : {};
    }, ["a"], scope);
    assert.deepEqual(calls.sort(), ["summary", ...expected].sort(), scope);
  }
});

test("a shared athlete without the active area's data never loads unrelated payloads", async () => {
  const calls = [];
  const bundles = await loadComparisonBundles(async (url) => { calls.push(url); return summary("a", false); }, ["a"], "pitching");
  assert.equal(calls.length, 1);
  assert.equal(bundles[0].available, false);
  assert.equal(bundles[0].tracking, null);
});

test("full comparisons load all available areas only after opting in", async () => {
  const calls = [];
  await loadComparisonBundles(async (url) => {
    calls.push(url.split("/").pop());
    return url.endsWith("/summary") ? summary() : {};
  }, ["a"], "all");
  assert.deepEqual(calls.sort(), ["summary", "tracking", "pitching", "readiness", "assessments"].sort());
});

test("the report layer never invokes builders outside requested tracking domains", async () => {
  const called = [];
  const build = (id) => async () => { called.push(id); return { athleteUuid: "a", metrics: [{ category: "test", name: "test", value: 1 }] }; };
  const { buildDomainsWithPercentiles } = compile("lib/athlete-tracking/percentiles.ts", {
    "@/lib/db/prisma": { prisma: {} },
    "@/lib/percentiles/populations": { definePopulation: (_key, _build, empty) => async () => empty() },
    "@/lib/octane/pitchingPayload": { buildPitchingPayload: build("pitching") },
    "@/lib/octane/hittingPayload": { buildHittingPayload: build("hitting") },
    "@/lib/octane/mobilityPayload": { buildMobilityPayload: build("mobility") },
    "@/lib/octane/athleticScreenPayload": { buildAthleticScreenPayload: build("athleticScreen") },
    "@/lib/octane/armActionPayload": { buildArmActionPayload: build("armAction") },
    "@/lib/octane/proteusPayload": { buildProteusPitcherPayload: build("proteus"), buildProteusHitterPayload: build("proteus") },
  });
  const counts = { armAction: 1, athleticScreen: 1, mobility: 1, proteus: 1, kinematicsPitching: 1, kinematicsHitting: 1 };
  const result = await buildDomainsWithPercentiles("a", counts, undefined, ["mobility", "pitching"]);
  assert.deepEqual(called.sort(), ["mobility", "pitching"]);
  assert.deepEqual(result.map((d) => d.domainId).sort(), ["mobility", "pitching"]);
});
