/**
 * Short pitch names for Mechanics + Flight: "Sinker 4" = TrackMan pitch type + the 3D trial
 * number (trial numbers count within the QTM category, so the pair is unique in a session).
 * Unpaired trials use the QTM category ("Fastball 3").
 */

import { PITCH_LABELS, type PitchCode } from "@/lib/pitch-intel/pitch-types";
import type { SyncPitch } from "@/lib/coach/pitchSync";
import { PITCH_CATEGORY_LABEL, PITCH_CATEGORY_SHORT, type PitchCategory } from "@/lib/coach/biomech/pitchCategory";

export const trialKey = (t: { category: PitchCategory; trialIndex: number }) => `${t.category}:${t.trialIndex}`;

/** Group = TrackMan pitch type, or the QTM category for trials without a TrackMan pitch. */
export const groupOf = (p: SyncPitch) => (p.tm ? p.tm.code : `cat:${p.category}`);

export function groupLabel(group: string): string {
  if (group.startsWith("cat:")) return `${PITCH_CATEGORY_LABEL[group.slice(4) as PitchCategory].one} (no TrackMan)`;
  const l = PITCH_LABELS[group as PitchCode] ?? group;
  return l.endsWith("s") ? l : `${l}s`;
}

export const pitchVelo = (p: SyncPitch) => p.flight.velo ?? p.velo3d ?? null;

export function pitchNames(pitches: SyncPitch[]): Map<string, string> {
  const base = (p: SyncPitch) => `${p.tm ? PITCH_LABELS[p.tm.code] : PITCH_CATEGORY_LABEL[p.category].one} ${p.trialIndex}`;
  const counts = new Map<string, number>();
  for (const p of pitches) counts.set(base(p), (counts.get(base(p)) ?? 0) + 1);
  // A clash is only possible across QTM categories; add the category then.
  return new Map(pitches.map((p) => [trialKey(p), counts.get(base(p))! > 1 ? `${base(p)} (${PITCH_CATEGORY_SHORT[p.category]})` : base(p)]));
}
