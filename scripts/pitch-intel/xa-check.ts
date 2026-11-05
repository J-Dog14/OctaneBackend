/**
 * Sanity checks against Ryan's live Worker. Run: npm run xa:check
 *
 * 1. Sends an example arsenal and prints the raw response next to what the coach suite reads
 *    from it (normalized grade / label / description, metrics, Arsenal Fit, moves).
 * 2. Level mapping: how the Worker itself maps MLB / AAA / College / Atlantic League / blank. We only
 *    send MLB, College, High School and Youth (xaLevel), so this is informational.
 * 3. Release-side sign: the same arsenal with releaseSide flipped and no arm angle. Identical grades =
 *    the Worker still ignores the sign (true on Nov 5 2026).
 */
import "./env";
import { gradeArsenals, postScoreArsenal, xarsenalUrl, type XaItemIn } from "../../lib/pitch-intel/xarsenal/worker";

const pitches = [
  { key: "FF", code: "FF", count: 140, velocity: 92.1, spinRate: 2350, ivb: 16.2, hb: 9.1, extension: 6.3, vaa: -4.8, armAngle: 41, releaseHeight: 5.9, releaseSide: 2.1 },
  { key: "SL", code: "SL", count: 60, velocity: 84.0, spinRate: 2500, ivb: 1.0, hb: -6.5 },
  { key: "CH", code: "CH", count: 40, velocity: 84.5, spinRate: 1750, ivb: 7.5, hb: 14.0 },
];
const item: XaItemIn = { id: "example", hand: "R", level: "College", pitches };

const brief = (r: unknown) => {
  const o = (r ?? {}) as Record<string, unknown>;
  const ps = Array.isArray(o.pitches) ? (o.pitches as Array<Record<string, unknown>>) : [];
  return `compLevel=${o.compLevel} arsenal=${o.arsenalScore} ` + ps.map((p) => `${p.key}=${p.score}`).join(" ");
};

async function main() {
  console.log(`Worker: ${xarsenalUrl()}`);
  const [raw] = await postScoreArsenal([item]);
  console.log("--- raw ---");
  console.log(JSON.stringify(raw, null, 2));
  const parsed = (await gradeArsenals([item])).get("example");
  console.log("--- as the coach suite reads it ---");
  console.log(JSON.stringify({ arsenal: parsed?.arsenal, pitches: Object.fromEntries(parsed?.pitches ?? []) }, null, 2));

  console.log("--- level mapping ---");
  const levels = ["MLB", "AAA", "College", "Atlantic League", ""];
  const lv = await postScoreArsenal(levels.map((level, i) => ({ id: String(i), hand: "R", level: level as XaItemIn["level"], pitches })));
  levels.forEach((l, i) => console.log(`  ${JSON.stringify(l).padEnd(18)} ${brief(lv[i])}`));

  console.log("--- release-side sign (no arm angle) ---");
  const noArm = pitches.map(({ armAngle: _a, ...p }) => ({ ...p, releaseHeight: 5.9, releaseSide: 2.1 }));
  const flipped = noArm.map((p) => ({ ...p, releaseSide: -p.releaseSide }));
  const sg = await postScoreArsenal([
    { id: "pos", hand: "R", level: "MLB", pitches: noArm },
    { id: "neg", hand: "R", level: "MLB", pitches: flipped },
  ]);
  console.log(`  +2.1 ft  ${brief(sg[0])}`);
  console.log(`  -2.1 ft  ${brief(sg[1])}`);
  console.log(brief(sg[0]) === brief(sg[1]) ? "  same grades: the Worker ignores the release-side sign" : "  DIFFERENT: the release-side sign matters; tell Ryan / Claude");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
