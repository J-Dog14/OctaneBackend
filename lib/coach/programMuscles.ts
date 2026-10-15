/**
 * Exercise → muscles for the Program tab's body heat map.
 *
 * Muscles come from, in order:
 *   1. a coach override in coach.exercise_muscles (keyed by normalized name),
 *   2. the exercise's description in the 8ctane app — exercises written with the
 *      app's template carry "Primary Muscles: …" / "Secondary Muscles: …" lines
 *      from a fixed vocabulary (DESCRIPTION_TERMS). This is the source of truth and
 *      stays current: new or edited exercises arrive with every App DB sync.
 *   3. the name rules below (first match wins), then
 *   4. a broad default for the exercise type.
 * Shared by the server (lib/coach/program.ts) and the client (labels).
 */

export type MuscleId =
  | "neck" | "traps" | "lower_traps" | "front_delts" | "rear_delts" | "rotator_cuff" | "chest" | "serratus"
  | "biceps" | "triceps" | "forearms" | "abs" | "obliques" | "lats" | "upper_back"
  | "lower_back" | "glutes" | "abductors" | "adductors" | "hip_flexors" | "quads"
  | "hamstrings" | "calves";

export const MUSCLES: Record<MuscleId, string> = {
  neck: "Neck",
  traps: "Traps",
  lower_traps: "Lower traps",
  front_delts: "Shoulders (front/side)",
  rear_delts: "Rear delts",
  rotator_cuff: "Rotator cuff",
  chest: "Chest",
  serratus: "Serratus anterior",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms / grip",
  abs: "Abs",
  obliques: "Obliques",
  lats: "Lats",
  upper_back: "Upper back",
  lower_back: "Lower back",
  glutes: "Glutes",
  abductors: "Glute med / abductors",
  adductors: "Adductors",
  hip_flexors: "Hip flexors",
  quads: "Quads",
  hamstrings: "Hamstrings",
  calves: "Calves",
};

export const MUSCLE_IDS = Object.keys(MUSCLES) as MuscleId[];

export interface MuscleMap {
  primary: MuscleId[];
  secondary: MuscleId[];
}

export type MuscleSource = "override" | "description" | "rule" | "type" | "none";

/**
 * The app's description vocabulary → body-map muscles. Terms seen in the App DB
 * exercise library (Primary/Secondary Muscles lines); anything else is reported
 * as an unknown term so it can be added here.
 */
export const DESCRIPTION_TERMS: Record<string, MuscleId[]> = {
  "glutes": ["glutes"],
  "core (general)": ["abs"],
  "core": ["abs"],
  "quadriceps": ["quads"],
  "quads": ["quads"],
  "serratus anterior": ["serratus"],
  "hamstrings": ["hamstrings"],
  "shoulders": ["front_delts"],
  "rotational core": ["obliques"],
  "anti rotational core": ["obliques", "abs"],
  "anti-rotational core": ["obliques", "abs"],
  "obliques": ["obliques"],
  "lower trapezius": ["lower_traps"],
  "lower traps": ["lower_traps"],
  "upper trapezius": ["traps"],
  "trapezius": ["traps"],
  "traps": ["traps"],
  "glute med": ["abductors"],
  "hip abductors": ["abductors"],
  "hip external rotators (er)": ["abductors"],
  "hip external rotators": ["abductors"],
  "rhomboids": ["upper_back"],
  "upper back": ["upper_back"],
  "chest": ["chest"],
  "triceps": ["triceps"],
  "biceps": ["biceps"],
  "calves": ["calves"],
  "lower back": ["lower_back"],
  "lats": ["lats"],
  "adductors (groin)": ["adductors"],
  "adductors": ["adductors"],
  "posterior shoulders": ["rear_delts"],
  "rear delts": ["rear_delts"],
  "forearms": ["forearms"],
  "shoulder er": ["rotator_cuff"],
  "shoulder ir": ["rotator_cuff"],
  "er's": ["rotator_cuff"],
  "rotator cuff": ["rotator_cuff"],
  "hip flexors": ["hip_flexors"],
  "neck": ["neck"],
};

function termsToMuscles(value: string, unknown: string[]): MuscleId[] {
  const out: MuscleId[] = [];
  for (const raw of value.split(/,|;|\//)) {
    const t = raw.trim().replace(/\.$/, "").toLowerCase().replace(/\s+/g, " ");
    if (!t || t === "none" || t === "n/a" || t === "-") continue;
    const ids = DESCRIPTION_TERMS[t] ?? DESCRIPTION_TERMS[t.replace(/s$/, "")];
    if (!ids) {
      unknown.push(raw.trim());
      continue;
    }
    for (const id of ids) if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * "Primary Muscles: Chest, Shoulders" / "Secondary Muscles: …" lines from an app
 * exercise description; null when the description has neither line.
 */
export function parseDescriptionMuscles(description: string | null | undefined): { map: MuscleMap; unknown: string[] } | null {
  if (!description) return null;
  const text = description.replace(/\\n/g, "\n");
  const p = /primary muscles?\s*:\s*([^\n]*)/i.exec(text);
  const s = /secondary muscles?\s*:\s*([^\n]*)/i.exec(text);
  if (!p && !s) return null;
  const unknown: string[] = [];
  const primary = p ? termsToMuscles(p[1]!, unknown) : [];
  const secondary = (s ? termsToMuscles(s[1]!, unknown) : []).filter((m) => !primary.includes(m));
  return { map: { primary, secondary }, unknown };
}

type Rule = [RegExp, MuscleId[], MuscleId[]];

// Order matters: specific patterns before general ones ("romanian deadlift" before
// "deadlift", "split squat" before "squat", "landmine press" before "press").
const RULES: Rule[] = [
  // ---- not muscle work (mobility, breathing, activation drills) ----
  [/\b(breath|breathing|stretch|foam roll|soft tissue|mobility|\bmobs?\b|cars?\b|nerve glide|thread the needle|cat cow|world'?s greatest|open books?|pails?\b|rails?\b|video|vestibular|mobilization|can openers?|pelvic tilt|frog flow|bretzel|windmill|t[- ]?spine|pvc (rotation|swing)|stomp (and )?twist|torso pour|treadmill|scorpion|\bpum\b|\bpvc\b|indian club|roll[- ]?in|hinge (aways?|progression|touch|shakes?)|warm[- ]?up)/, [], []],
  // ---- warm-up / prep isometrics and activation (the app types many of these WARM_UP) ----
  [/\b(90\/90 split squat|split squat iso|ss overcoming|spanish squat|wall sit)/, ["quads"], ["glutes", "adductors"]],
  [/\b(90\/90 (hip shift|ir lift))/, ["glutes"], ["abductors", "hip_flexors"]],
  [/\b(hip airplane|pelvic drop|outer hip|glute wall|clamshell|clam shell)/, ["abductors", "glutes"], []],
  [/\b(hip flexor (iso|overcoming)|hip flexion|knee drive|high knee|march)/, ["hip_flexors"], ["abs"]],
  [/\b(butt kick)/, ["hamstrings"], ["hip_flexors"]],
  [/\b(skip|carioca|shuffle|backpedal|heiden|elephant walk)/, ["calves", "glutes"], ["hip_flexors", "adductors", "hamstrings"]],
  [/\b(no money|horizontal abduction|swimmers|cuban press|j[- ]?band|body blade|clappers|d2 flex|band wall walk)/, ["rotator_cuff", "rear_delts"], ["lower_traps", "upper_back"]],
  [/\b(trap raise|y'?s\b|trx y\b|iyt\b)/, ["lower_traps", "rear_delts"], ["rotator_cuff", "upper_back"]],
  [/\b(serratus|push ?up plus|pushup plus|wall slides?)/, ["serratus"], ["front_delts"]],
  [/\b(elbow tke)/, ["triceps"], ["forearms"]],
  [/\b(bicep)/, ["biceps"], ["forearms"]],
  [/\b(lateral flexion|side crunch|screwdriver)/, ["obliques"], ["abs"]],
  [/\b(cable pec fly)/, ["chest"], ["front_delts"]],
  [/\b(lateral line)/, ["calves", "abductors"], ["glutes"]],
  [/\b(hyper ?extension|back extension)/, ["lower_back", "glutes"], ["hamstrings"]],
  [/\b(gravity drop|verticals?\b)/, ["calves"], ["quads"]],
  [/\b(side start|falling start|jump start|split start|\bstart\b)/, ["glutes", "quads"], ["hamstrings", "calves", "hip_flexors"]],
  [/\b(butterfly)/, ["adductors"], []],
  [/\b(shoulder taps|ball switch)/, ["abs"], ["obliques", "front_delts"]],
  [/\b(cobra hang|hang\b)/, ["forearms", "lats"], ["rotator_cuff"]],
  // ---- hinge ----
  [/\b(rdl|romanian|stiff[- ]?leg|single[- ]leg deadlift|sl deadlift|good ?morning)/, ["hamstrings", "glutes"], ["lower_back", "forearms"]],
  [/\b(trap ?bar|hex ?bar).*(deadlift|dl)\b/, ["glutes", "quads", "hamstrings"], ["lower_back", "traps", "forearms"]],
  [/(deadlift|\bdl\b)/, ["glutes", "hamstrings", "lower_back"], ["quads", "traps", "forearms"]],
  [/\b(kb|kettlebell)?\s*swing/, ["glutes", "hamstrings"], ["lower_back", "forearms"]],
  [/\b(hip thrust|glute bridge|bridge|hip lift)/, ["glutes"], ["hamstrings"]],
  [/\b(nordic|leg curl|hamstring curl|slider curl|glute[- ]ham|ghr|hamstring bridge)/, ["hamstrings"], ["calves"]],
  [/\b(back extension|reverse hyper|superman|45 degree (back|hyper|extension))/, ["lower_back", "glutes"], ["hamstrings"]],
  // ---- single-leg / squat ----
  [/\b(split squat|bulgarian|rfess|rear foot)/, ["quads", "glutes"], ["adductors", "hamstrings"]],
  [/\b(lunge|step[- ]?up|skater squat|pistol)/, ["quads", "glutes"], ["hamstrings", "adductors", "calves"]],
  [/\b(cossack|lateral squat|side lunge|lateral lunge)/, ["adductors", "quads", "glutes"], []],
  [/(squat|leg press|\bhack)/, ["quads", "glutes"], ["adductors", "lower_back"]],
  [/\b(leg extension|spanish squat|sissy)/, ["quads"], []],
  [/\b(copenhagen|adductor|adduction|groin)/, ["adductors"], ["obliques"]],
  [/\b(abductor|abduction|clam|band walk|monster walk|lateral walk|fire hydrant|side[- ]lying (hip|leg))/, ["abductors"], ["glutes"]],
  [/\b(calf|calves|heel raise|tib raise|tibialis|ankle)/, ["calves"], []],
  [/\b(hip flexor|psoas|knee drive|march|leg raise|hanging knee)/, ["hip_flexors", "abs"], []],
  // ---- olympic / power ----
  [/\b(clean|snatch|jerk|high pull)/, ["glutes", "quads", "traps"], ["hamstrings", "front_delts", "calves"]],
  [/\b(sled push|prowler)/, ["quads", "glutes"], ["calves", "triceps"]],
  [/\b(sled (pull|drag)|backward sled)/, ["quads", "hamstrings"], ["glutes", "calves"]],
  [/\b(sprint|acceleration|flying|build[- ]?up|resisted run)/, ["hamstrings", "glutes"], ["quads", "calves", "hip_flexors"]],
  [/\b(jump|bound|hop|depth|pogo|skater|broad)/, ["quads", "glutes", "calves"], ["hamstrings"]],
  // ---- shoulder care ----
  [/\b(external rotation|internal rotation|\ber\b|\bir\b|cuff|90\/90 (er|ir)|sleeper|scap|serratus|wall slide|y[- ]?t[- ]?w|ytw|\bi[- ]?y[- ]?t|blackburn|prone (y|t|w)|face ?pull|pull[- ]?apart|reverse fly|rear delt)/, ["rotator_cuff", "rear_delts"], ["upper_back"]],
  [/\b(pro(nation)?[- ]?sup(ination)?|wrist|forearm|grip|farmer|carry|plate pinch|rice bucket|towel hang|dead hang)/, ["forearms"], ["traps"]],
  // ---- rotational / med ball ----
  [/\b(med ?ball|mb)\b.*(chest pass|push)/, ["chest", "triceps"], ["front_delts", "obliques"]],
  [/\b(med ?ball|mb)\b.*(slam)/, ["lats", "abs"], ["front_delts"]],
  [/\b(med ?ball|mb)\b|\b(scoop toss|shot put|rotational throw|rotational toss)/, ["obliques", "glutes"], ["abs", "front_delts"]],
  [/\b(pallof|anti[- ]rotation|landmine rotation|chop|lift\b.*cable|woodchop|russian twist|rotation)/, ["obliques"], ["abs"]],
  [/\b(side plank|suitcase|copenhagen plank)/, ["obliques"], ["abductors", "abs"]],
  [/\b(plank|dead ?bug|hollow|bird ?dog|ab wheel|rollout|stir the pot|bear crawl|crunch|sit[- ]?up|v[- ]?up|toes to bar|core)/, ["abs"], ["obliques", "hip_flexors"]],
  // ---- upper push ----
  [/\b(landmine press|half[- ]kneeling press)/, ["front_delts", "chest"], ["triceps", "obliques"]],
  [/\b(overhead press|ohp|military|shoulder press|push press|z press|arnold)/, ["front_delts"], ["triceps", "traps"]],
  [/\b(lateral raise|front raise|side raise)/, ["front_delts"], []],
  [/\b(bench|chest press|incline|decline|push[- ]?up|pushup|floor press|fly|flye|pec|dips?\b)/, ["chest", "triceps"], ["front_delts"]],
  [/\b(tricep|triceps|skull|pushdown|kickback|close grip)/, ["triceps"], []],
  // ---- upper pull ----
  [/\b(pull[- ]?up|chin[- ]?up|lat pull|pulldown|pullover|straight arm)/, ["lats"], ["biceps", "upper_back"]],
  [/\b(row|rows|inverted|seal row|meadows)/, ["upper_back", "lats"], ["biceps", "rear_delts"]],
  [/\b(shrug)/, ["traps"], ["forearms"]],
  [/\b(curl)\b/, ["biceps"], ["forearms"]],
  [/\b(neck)/, ["neck"], []],
  [/\b(turkish get ?up|tgu)/, ["front_delts", "abs"], ["glutes", "rotator_cuff"]],
];

/** Broad default per Exercise.type when no rule matches (secondary weight only). */
const TYPE_DEFAULTS: Record<string, MuscleMap> = {
  LOWER_BODY_LIFT: { primary: [], secondary: ["quads", "glutes", "hamstrings"] },
  UPPER_BODY_LIFT: { primary: [], secondary: ["chest", "upper_back", "front_delts"] },
  CORE: { primary: ["abs"], secondary: ["obliques"] },
  SHOULDER_CARE: { primary: ["rotator_cuff"], secondary: ["rear_delts"] },
  SPRINT: { primary: ["hamstrings", "glutes"], secondary: ["quads", "calves"] },
  PLYOMETRIC: { primary: ["quads", "glutes", "calves"], secondary: [] },
  MED_BALL: { primary: ["obliques"], secondary: ["abs", "glutes"] },
};

/** Types that aren't body-region strength work (throwing plyos / hitting) — not drawn. WARM_UP is drawn: the app files a lot of real
 * muscle work (calf and tib raises, Ys, rear delt flys, isometrics) under it; stretches and drills fall out via the rules. */
export const NON_MUSCLE_TYPES = new Set(["PLYO", "HITTING_DRILL"]);

export function normalizeExerciseName(name: string): string {
  return name.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'/ -]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Stretches, breathing, mobility, soft tissue, nerve glides… — deliberately no muscles (not "unmapped"). */
export function isNonMuscleWork(name: string): boolean {
  return RULES[0]![0].test(normalizeExerciseName(name));
}

export function musclesFor(
  name: string,
  type: string | null,
  overrides?: Map<string, MuscleMap>,
  description?: string | null,
): { map: MuscleMap; source: MuscleSource; unknownTerms?: string[] } {
  const norm = normalizeExerciseName(name);
  const o = overrides?.get(norm);
  if (o) return { map: o, source: "override" };
  // Throwing / hitting / warm-up work isn't drawn on the lift body map, even when described.
  if (type && NON_MUSCLE_TYPES.has(type)) return { map: { primary: [], secondary: [] }, source: "none" };
  const fromDesc = parseDescriptionMuscles(description);
  if (fromDesc && (fromDesc.map.primary.length || fromDesc.map.secondary.length)) {
    return { map: fromDesc.map, source: "description", unknownTerms: fromDesc.unknown };
  }
  if (type && NON_MUSCLE_TYPES.has(type)) return { map: { primary: [], secondary: [] }, source: "none" };
  for (const [re, primary, secondary] of RULES) {
    if (re.test(norm)) return { map: { primary, secondary }, source: primary.length || secondary.length ? "rule" : "none" };
  }
  const def = type ? TYPE_DEFAULTS[type] : undefined;
  return def ? { map: def, source: "type" } : { map: { primary: [], secondary: [] }, source: "none" };
}
