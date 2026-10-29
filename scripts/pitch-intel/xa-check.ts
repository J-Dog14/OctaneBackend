/**
 * Sends the example arsenal from "xArsenal v3 + 8-Stuff+ — Grading Rules" to Ryan's Worker and
 * prints the raw response next to what the coach suite reads from it. Run: npm run xa:check
 */
import "./env";
import { gradeArsenals, xarsenalUrl } from "../../lib/pitch-intel/xarsenal/worker";

const item = {
  id: "example",
  hand: "R" as const,
  level: "College" as const,
  pitches: [
    { key: "FF", code: "FF", count: 140, velocity: 92.1, spinRate: 2350, ivb: 16.2, hb: 9.1, extension: 6.3, vaa: -4.8, armAngle: 41, releaseHeight: 5.9, releaseSide: 2.1 },
    { key: "SL", code: "SL", count: 60, velocity: 84.0, spinRate: 2500, ivb: 1.0, hb: -6.5 },
  ],
};

async function main() {
  console.log(`Worker: ${xarsenalUrl()}`);
  const res = await fetch(`${xarsenalUrl()}/?action=scoreArsenal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [item] }),
  });
  console.log(`HTTP ${res.status}\n--- raw ---`);
  console.log(JSON.stringify(JSON.parse(await res.text()), null, 2));
  const parsed = (await gradeArsenals([item])).get("example");
  console.log("--- as the coach suite reads it ---");
  console.log(JSON.stringify({ arsenal: parsed?.arsenal, pitches: Object.fromEntries(parsed?.pitches ?? []) }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
