/**
 * Rule-based written read for the Hitting report, following the
 * hitting-swing-breakdown skill's coaching language (references/coaching_language.md):
 * lead with what's working, tell the connected story (trunk opens early → low
 * separation → over-rotation is one fault), tie drills to checkpoints, no
 * percentiles or peer ranking, development framing for youth hitters.
 */

import type { Status } from "@/lib/coach/biomech/framework";
import type { Checkpoint, SwingMetrics } from "./extract";

export interface Finding {
  heading: string;
  body: string;
}

export interface SwingRead {
  summary: string;
  story: string | null;
  whatsWorking: Finding[];
  focusAreas: Finding[];
  drills: Finding[];
  bottomLine: string;
  flags: string[];
}

const good = (s: Status | undefined) => s === "best" || s === "good";
const bad = (s: Status | undefined) => s === "warn" || s === "bad";

function batContext(mph: number, age: number | null): string {
  // General reference only (skill: rough, widely cited ranges; there is no 8ctane hitting cohort).
  if (age != null && age < 15) return mph >= 55 ? "solid for a 14U bat" : "still building for 14U";
  if (age != null && age < 19) return mph >= 65 ? "above the typical high-school range" : mph >= 60 ? "in the typical high-school range" : "below the typical high-school range";
  return mph >= 70 ? "at a pro-level number" : mph >= 65 ? "a strong amateur number" : "with room to grow";
}

export function writeSwingRead(firstName: string, m: SwingMetrics, age: number | null): SwingRead {
  const cp = new Map<string, Checkpoint>(m.checkpoints.map((c) => [c.id, c]));
  const st = (id: string) => cp.get(id)?.status;
  const youth = age != null && age < 16;
  const he = firstName;
  const bat = m.bat.mean;

  const whatsWorking: Finding[] = [];
  const focusAreas: Finding[] = [];
  const drills: Finding[] = [];
  const flags: string[] = [];

  // --- the connected cluster: trunk opens early → low separation → over-rotation ---
  const earlyTrunk = bad(st("CP3"));
  const lowSep = bad(st("CP5"));
  const overRot = (cp.get("CP6a")?.status === "bad" || cp.get("CP6a")?.status === "warn") && (m.rotation.pelvis.Contact ?? 0) < 0;
  const clusterCount = [earlyTrunk, lowSep, overRot].filter(Boolean).length;

  const seq = m.sequence;
  const xf = m.rotation.xfactor.Lead_Foot_Down;
  const pzL = m.rotation.pelvis.Lead_Foot_Down;
  const pzC = m.rotation.pelvis.Contact;
  const tzC = m.rotation.trunk.Contact;

  // ----- what's working -----
  if (good(st("CP1"))) {
    whatsWorking.push({
      heading: "Energy builds out to the barrel",
      body: `Peak speeds climb pelvis ${seq.peaks.pelvis?.toFixed(0)} → thorax ${seq.peaks.thorax?.toFixed(0)} → hand ${seq.peaks.hand?.toFixed(0)} → bat ${seq.peaks.bat?.toFixed(0)} °/s, so each segment hands off to the next.${seq.properRate != null && seq.properRate < 0.75 ? ` The timing fired in order on ${Math.round(seq.properRate * 100)}% of swings — the engine is there, the repeatability is the next piece.` : ""}`,
    });
  }
  if (good(st("CP2"))) {
    whatsWorking.push({ heading: "Loads into the back hip", body: `${he} gathers closed in the load — ${cp.get("CP2")!.valueText} — so there's coil stored to unwind.` });
  }
  if (good(st("CP4")) && pzL != null) {
    whatsWorking.push({ heading: "Lower half leads", body: `The pelvis is already open to ${pzL.toFixed(0)}° when the front foot lands — the hips are firing ahead of the shoulders.` });
  }
  if (good(st("CP5")) && xf != null) {
    whatsWorking.push({ heading: "Banks separation", body: `${xf.toFixed(0)}° of hip-shoulder separation at foot-down, at or above the 30° we want. That stretch is the swing's main power source.` });
  }
  if (good(st("CP6a")) && good(st("CP6b"))) {
    whatsWorking.push({ heading: "Arrives square", body: `Pelvis ${pzC! >= 0 ? "+" : ""}${pzC!.toFixed(0)}° and trunk ${tzC! >= 0 ? "+" : ""}${tzC!.toFixed(0)}° at contact — square to slightly closed, not spinning off the ball.` });
  }
  if (good(st("CP7a"))) {
    whatsWorking.push({ heading: "Posts the front leg", body: `The lead knee goes ${m.knee.flexLfd!.toFixed(0)}° → ${m.knee.flexContact!.toFixed(0)}° from foot-down to contact — a firm brace to rotate over. Keep it; don't drill it away.` });
  }

  // ----- focus areas (connected story first) -----
  let story: string | null = null;
  // The connected story starts with the trunk opening early; without CP3 failing, the
  // separation and contact faults are read on their own rather than blamed on the trunk.
  if (earlyTrunk && clusterCount >= 2) {
    story = `The trunk opens before the front foot is down, so separation ${xf != null ? `sits at ${xf.toFixed(0)}°` : "is low"} and ${overRot ? "the pelvis keeps spinning past square into contact" : "the swing loses its stretch"} — one fault seen ${clusterCount === 3 ? "three" : "two"} ways. Hold the trunk closed and the separation and contact position should follow.`;
    focusAreas.push({ heading: "Hold the trunk closed, bank separation", body: story });
    drills.push({ heading: "Step-behind / walk-through swings", body: "Cue: \"hips open, shoulders wait.\" Moves CP3 and CP5 — the trunk holds while the pelvis clears." });
    drills.push({ heading: "Band-resisted coil and hold", body: "Load into the back hip against a band and hold the shoulders closed through the stride. Builds the separation CP5 is looking for." });
  } else {
    if (earlyTrunk) {
      focusAreas.push({ heading: "Trunk opens early", body: `${cp.get("CP3")!.valueText}; we want 3° or less. Opening before the foot plants leaks the stretch.` });
      drills.push({ heading: "Step-behind swings", body: "Cue: \"shoulders wait for the foot.\" Moves CP3." });
    }
    if (lowSep && xf != null) {
      focusAreas.push({ heading: "Separation under target", body: `${xf > 29 ? `${xf.toFixed(1)}° of separation at foot-down, just under` : `${xf.toFixed(0)}° of separation at foot-down, under`} the 30° we want. More stretch between an opening pelvis and a closed trunk is free bat speed.` });
      drills.push({ heading: "Band-resisted coil and hold", body: "Hold the shoulders closed as the hips start to open. Moves CP5." });
    }
  }
  if (bad(st("CP4")) && pzL != null) {
    focusAreas.push({ heading: "Pelvis late to open", body: `The pelvis is still at ${pzL.toFixed(0)}° at foot-down (we want 90° or less). The lower half should be clearing as the foot lands.` });
  }
  if (!story && (bad(st("CP6a")) || bad(st("CP6b")))) {
    const sg = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}°`;
    const pNeg = pzC != null && pzC < 0;
    const tNeg = tzC != null && tzC < 0;
    const pClosed = pzC != null && pzC > 15;
    const tClosed = tzC != null && tzC > 15;
    const parts = [pzC != null ? `pelvis ${sg(pzC)}` : null, tzC != null ? `trunk ${sg(tzC)}` : null].filter(Boolean).join(", ");
    let heading: string;
    let body: string;
    if ((pNeg && tClosed) || (tNeg && pClosed)) {
      heading = pNeg ? "Hips spin off, shoulders arrive late" : "Shoulders spin off, hips stay closed";
      body = `At contact (${parts}) the ${pNeg ? "pelvis has rotated past square while the trunk is still closed" : "trunk has rotated past square while the pelvis is still closed"}. The two halves are out of sync at the ball; the checkpoint wants both at 0° to +15°.`;
    } else if (pNeg || tNeg) {
      heading = "Spins past square at contact";
      body = `At contact (${parts}) the ${pNeg && tNeg ? "swing has" : pNeg ? "pelvis has" : "trunk has"} rotated past square, bleeding force off the plane. The checkpoint wants 0° to +15°.`;
    } else if ((pzC ?? 0) > 25 || (tzC ?? 0) > 25) {
      heading = "Still closed at contact";
      body = `At contact (${parts}) the ${(tzC ?? 0) > 25 ? "trunk" : "pelvis"} is still well closed — past the +15° window. Often a late or arm-driven barrel; check it against the sequence timing.`;
    } else {
      heading = "A touch closed at contact";
      body = `Contact arrives a little closed (${parts}). Usually fine — worth watching against timing.`;
    }
    focusAreas.push({ heading, body });
    if (pNeg || tNeg) drills.push({ heading: "Stop-square rotational throws", body: "Med-ball or swing reps with a \"stop square\" intent. Moves CP6." });
  }
  if (cp.get("CP7a")?.status === "warn") {
    focusAreas.push({ heading: "Front leg isn't posting", body: `The lead knee goes ${m.knee.flexLfd?.toFixed(0)}° → ${m.knee.flexContact?.toFixed(0)}°; we want ~45° at plant straightening toward 0° at contact. A firmer post gives the swing an axis to rotate over.` });
  }
  if (st("CP1") === "warn") {
    focusAreas.push({ heading: "Sequence doesn't build", body: "Peak speeds don't climb cleanly from pelvis to bat, so energy isn't being passed outward. Sequencing work before strength work." });
  }
  if (seq.downswingBeforeLfdMs != null && seq.downswingBeforeLfdMs > 20) {
    flags.push(`The hands start down ${seq.downswingBeforeLfdMs.toFixed(0)} ms before the front foot is planted — the swing is starting before the base is set.`);
  }
  if (m.rotation.flippedSwings > 0) {
    flags.push(`${m.rotation.flippedSwings} of ${m.n} swings were recorded in the mirrored lab frame (pelvis negative at foot-down); their rotation was flipped so open/closed reads the same way.`);
  }
  if (m.tilt.available && !m.tilt.ok) flags.push(...m.tilt.messages);

  // ----- summary / bottom line -----
  const batTxt = bat != null ? `${bat.toFixed(1)} mph bat speed (${batContext(bat, age)} — general reference, there's no 8ctane hitting cohort yet)` : "no bat speed in this export";
  const strengths = whatsWorking.map((w) => w.heading.toLowerCase());
  const summary = `${he} averaged ${batTxt} over ${m.n} swing${m.n === 1 ? "" : "s"}${m.bat.min != null && m.bat.max != null && m.n > 1 ? ` (${m.bat.min.toFixed(1)}–${m.bat.max.toFixed(1)})` : ""}. ${
    strengths.length ? `Working: ${strengths.slice(0, 3).join("; ")}.` : "The foundation is still coming together."
  } ${focusAreas.length ? `Main focus: ${focusAreas[0]!.heading.toLowerCase()}.` : "Nothing the export can grade reads out of band."}`;

  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const bottomLine = cap(focusAreas.length
    ? `${youth ? `${he} is still growing into this pattern, so frame it as development: ` : ""}${story ? "the single idea is to hold the trunk closed until the front foot is down — the separation and contact position follow from that." : `the priority is ${focusAreas[0]!.heading.toLowerCase()}.`}${whatsWorking.length ? ` Keep what's already working (${strengths.slice(0, 3).join(", ")}).` : ""}`
    : `${youth ? `${he} is still growing — ` : ""}every checkpoint the export can grade reads in band. The next gains come from bat speed and repeating the best-sequenced swing.`);

  return { summary, story, whatsWorking, focusAreas, drills, bottomLine, flags };
}
