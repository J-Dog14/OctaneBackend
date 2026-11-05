/**
 * xArsenal presentation parity with Ryan's frontend (handoff reference/xa-frontend.js self-test,
 * Garrett Cleavinger 2026 golden fixture) and parsing of the Worker response shape (handoff 05 §4).
 * Run: npm run test:xarsenal
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { xaDescribe, xaGrade, xaLabel, xaSlotName, xaWhy } from "../lib/pitch-intel/xarsenal/normalize";
import { parseResult, xaLevel } from "../lib/pitch-intel/xarsenal/worker";

// Cleavinger 2026 (LHP, MLB): scores and metric tiers from fixtures/cleavinger_2026_xarsenal_expected.json.
const ST = { velocity: [41, "primary"], hb: [65, "primary"], hbDiff: [62, "secondary"], vaa: [61, "secondary"], spinRate: [57, "minor"], ivb: [51, "minor"], ivbDiff: [55, "minor"], extension: [43, "minor"] } as const;

test("grade = score rounded to 5, clamped 20-80; label from the grade", () => {
  const cases: Array<[number, string]> = [[65, "Plus"], [64, "Plus"], [58, "Plus"], [57, "Above Avg"], [53, "Above Avg"], [51, "Average"], [49, "Average"], [43, "Fringe"], [41, "Below Avg"], [40, "Below Avg"], [36, "Poor"], [73, "Plus-Plus"], [68, "Plus-Plus"], [92, "Elite"]];
  for (const [s, l] of cases) assert.equal(xaLabel(s), l, `label ${s}`);
  assert.equal(xaGrade(73), 75);
  assert.equal(xaGrade(12), 20);
  assert.equal(xaGrade(97), 80);
  assert.equal(xaGrade(null), null);
});

test("arsenal description (Cleavinger)", () => {
  const d = xaDescribe([{ key: "ST", score: 68 }, { key: "SL", score: 67 }, { key: "SI", score: 67 }, { key: "FF", score: 64 }], 73);
  assert.equal(d, "The Sweeper is a weapon (70, plus-plus). Overall the arsenal grades out plus-plus (75).");
  const d2 = xaDescribe([{ key: "FF", score: 62 }, { key: "CH", score: 44 }], 55);
  assert.equal(d2, "The 4-Seam is the best pitch (60, plus); the Changeup grades lowest (45, fringe). Overall the arsenal grades out above average (55).");
});

test("why sentence (Cleavinger sweeper)", () => {
  const ms = Object.entries(ST).map(([key, [score, importance]]) => ({ key, score, importance }));
  assert.equal(xaWhy(ms), "Carried by HB (65) and Run gap (62). Held back by Velo (41).");
  assert.equal(xaWhy([{ key: "velocity", score: 50, importance: "primary" }]), "Grades out evenly — no key metric far above or below average.");
});

test("slot names", () => {
  assert.equal(xaSlotName(31), "Low 3/4");
  assert.equal(xaSlotName(32), "Low 3/4");
  assert.equal(xaSlotName(45), "3/4");
  assert.equal(xaSlotName(15), "Sidearm");
});

test("parseResult replaces the Worker's labels and reads the full response", () => {
  const res = {
    compLevel: "MLB", arsenalScore: 73, arsenalGrade: "70", arsenalLabel: "Plus-Plus (worker cut)", description: "worker text",
    arsenalPitchScore: 72, arsenalStuffPlus: 113, stuffPlusVersion: "8-Stuff+ v1",
    arsenalFit: { score: 74, parts: { coverage: 78, platoon: 67, speed: 57, redundancy: 50 },
      detail: { directions: [{ name: "Ride", credit: 1 }, { name: "Drop", credit: 0.2 }], bestArmSide: 67, bestGloveSide: 68, speedSpread: 16.2, speedEvenness: 47, duplicates: [] } },
    moves: {
      add: [{ label: "Kick changeup", target: { velo: 87, ivb: 6, hb: 14 }, reason: "fills arm-side down", fitGain: 3, gain: 2 }],
      drop: [{ key: "SL", score: 44, reason: "overlaps the sweeper", gain: 1 }],
      rework: [{ key: "CU", score: 47, reason: "flat", levers: [{ direction: "more depth" }] }],
    },
    slot: { armAngle: 32, source: "measured" },
    pitches: [{
      key: "ST", code: "ST", category: "Breaking Ball", subtype: "Sweeper", displayType: "Sweeper",
      subtypeMix: [{ subtype: "Sweeper", share: 48 }, { subtype: "Lift Sweeper", share: 25 }, { subtype: "Depth Sweeper", share: 25 }],
      score: 68, grade: "70", gradeLabel: "Elite (worker cut)",
      metrics: Object.fromEntries(Object.entries(ST).map(([k, [score, importance]]) => [k, { score, status: "elite", importance, direction: "x", value: k === "hbDiff" ? -35.9 : null }])),
      levers: [{ metric: "velocity", gain: 12, direction: "more velo" }],
      vsFastball: "FF/SI", vaaEst: -8.2, spinEfficiency: 30, spinEffEstimated: true, stuffPlus: 115, stuffPlusType: 108,
    }],
  };
  const g = parseResult(res, "MLB");
  const a = g.arsenal!;
  assert.equal(a.score, 73);
  assert.equal(a.grade, 75);
  assert.equal(a.label, "Plus-Plus");
  assert.equal(a.description, "The Sweeper is a weapon (70, plus-plus). Overall the arsenal grades out plus-plus (75).");
  assert.equal(a.pitchScore, 72);
  assert.equal(a.fit, 74);
  assert.deepEqual(a.fitDetail!.parts, { coverage: 78, platoon: 67, speed: 57, redundancy: 50 });
  assert.deepEqual(a.fitDetail!.strongDirections, ["Ride"]);
  assert.equal(a.compLevel, "MLB");
  assert.deepEqual(a.moves.map((m) => m.kind), ["add", "drop", "rework"]);
  assert.deepEqual(a.moves[0]!.target, { velo: 87, ivb: 6, hb: 14 });
  assert.deepEqual(a.moves[2]!.focus, ["more depth"]);
  const st = g.pitches.get("ST")!;
  assert.equal(st.grade, 70);
  assert.equal(st.label, "Plus-Plus");
  assert.deepEqual(st.subtypeMix, { Sweeper: 48, "Lift Sweeper": 25, "Depth Sweeper": 25 });
  assert.deepEqual(st.metrics.map((m) => m.key), ["velocity", "hb", "hbDiff", "vaa", "spinRate", "ivb", "ivbDiff", "extension"]);
  assert.equal(st.metrics.find((m) => m.key === "hbDiff")!.value, -35.9);
  assert.equal(st.why, "Carried by HB (65) and Run gap (62). Held back by Velo (41).");
  assert.equal(st.vsFastball, "FF/SI");
  assert.equal(st.vaaEst, -8.2);
  assert.equal(st.spinEffEstimated, true);
  assert.equal(st.levers[0]!.points, 12);
});

test("levels: MiLB, Indy and blank grade as MLB", () => {
  const res = { arsenalScore: 50, pitches: [{ key: "FF", score: 50 }] };
  assert.equal(xaLevel("Atlantic League"), "MLB");
  assert.equal(xaLevel("AAA"), "MLB");
  assert.equal(xaLevel(""), "MLB");
  assert.equal(xaLevel("D1"), "College");
  assert.equal(xaLevel("HS"), "High School");
  assert.equal(xaLevel("14U"), "Youth");
  assert.equal(parseResult(res, "Atlantic League").arsenal!.compLevel, "MLB");
  assert.equal(parseResult(res, "14U").arsenal!.compLevel, "Youth (14U)");
});
