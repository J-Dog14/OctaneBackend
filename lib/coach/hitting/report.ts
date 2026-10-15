/**
 * Loads one hitting capture from the warehouse (f_hitting_trials per swing,
 * f_kinematics_hitting per session) and builds the swing-checkpoint report
 * (lib/coach/hitting/extract.ts + read.ts), the in-app version of the
 * hitting-swing-breakdown PDF.
 */

import { prisma } from "@/lib/db/prisma";
import { EVENT_LABEL, extractSwing, HitLookup, type Comp, type SessionMeans, type SwingMetrics, type SwingTrial } from "./extract";
import { writeSwingRead, type SwingRead } from "./read";

export interface SegmentRow {
  event: string;
  label: string;
  /** Mean across swings; null when the export doesn't have that component. */
  X: number | null;
  Y: number | null;
  Z: number | null;
  /** Single-valued export (no component suffix). */
  value: number | null;
}

export interface SegmentBlock {
  key: string;
  title: string;
  description: string;
  unit: string;
  rows: SegmentRow[];
  /** Peak values for the segment, when exported. */
  peaks: Array<{ label: string; value: number; unit: string }>;
}

export interface SegmentGroup {
  title: string;
  intro: string;
  segments: SegmentBlock[];
}

export interface HittingReport {
  athlete: { athleteUuid: string; name: string; age: number | null; heightIn: number | null; weightLb: number | null };
  sessionDate: string;
  sessions: string[];
  metrics: SwingMetrics;
  read: SwingRead;
  groups: SegmentGroup[];
  /** Variables found in this capture (for checking the mapping). */
  variableCount: number;
}

// Skill BACKBONE order: Head → Trunk → Trunk–Pelvis → Pelvis → Arms → Legs/Knee → Bat.
const BACKBONE: Array<{ title: string; intro: string; segments: Array<{ key: string; base: string; title: string; description: string; unit?: string; peaks?: Array<[string, string, string]> }> }> = [
  {
    title: "Head",
    intro: "Head position is the hitter's stable reference — how much it moves sets how well the eyes track the ball.",
    segments: [{ key: "head", base: "Head_Angle", title: "Head", description: "Head segment angle at each event." }],
  },
  {
    title: "Trunk",
    intro: "The trunk stores and releases the coil. It should hold closed into foot-down, then rotate hard into contact.",
    segments: [{ key: "trunk", base: "Trunk_Angle", title: "Trunk", description: "Z = axial rotation (higher = more closed, 0 = square, negative = over-rotated).", peaks: [["Max_Thorax_Ang_Vel", "Peak thorax angular velocity", "°/s"]] }],
  },
  {
    title: "Trunk–Pelvis",
    intro: "Hip-shoulder separation: the stretch between an opening pelvis and a still-closed trunk.",
    segments: [{ key: "sep", base: "Pelvis_Shoulders_Separation", title: "Pelvis–shoulders separation (Visual3D)", description: "Visual3D's built-in separation signal. Its axis/sign differ from the checkpoint's trunk-minus-pelvis X-factor, so read it as a trend." }],
  },
  {
    title: "Pelvis",
    intro: "The pelvis leads the swing — opening by foot-down and arriving square at contact.",
    segments: [{ key: "pelvis", base: "Pelvis_Angle", title: "Pelvis", description: "Z = axial rotation (higher = more closed, 0 = square, negative = over-rotated).", peaks: [["Max_Pelvis_Ang_Vel", "Peak pelvis angular velocity", "°/s"]] }],
  },
  {
    title: "Arms",
    intro: "The arms deliver the barrel: lead arm guides, trail arm drives, wrists release.",
    segments: [
      { key: "lsho", base: "Lead_Shoulder_Angle", title: "Lead shoulder", description: "Lead shoulder angle at each event." },
      { key: "tsho", base: "Trail_Shoulder_Angle", title: "Trail shoulder", description: "Trail shoulder angle at each event." },
      { key: "lelb", base: "Lead_Elbow_Angle", title: "Lead elbow", description: "Lead elbow angle at each event.", peaks: [["Max_Lead_Forearm_Ang_Vel", "Peak lead forearm angular velocity", "°/s"], ["Max_Lead_Hand_Ang_Vel", "Peak lead hand angular velocity", "°/s"]] },
      { key: "telb", base: "Trail_Elbow_Angle", title: "Trail elbow", description: "Trail elbow angle at each event." },
      { key: "lwr", base: "Left_Wrist_Angle", title: "Left wrist", description: "Left wrist angle at each event." },
      { key: "rwr", base: "Right_Wrist_Angle", title: "Right wrist", description: "Right wrist angle at each event." },
    ],
  },
  {
    title: "Legs / Knee",
    intro: "The front leg posts to create the axis the swing rotates over.",
    segments: [
      { key: "lknee", base: "Lead_Knee_Angle", title: "Lead knee", description: "X = flexion (larger = more bent): ~45° at foot-down straightening toward 0° at contact." },
      { key: "lkneev", base: "Lead_Knee_Ang_Vel", title: "Lead knee angular velocity", description: "How fast the lead knee is moving at each event.", unit: "°/s" },
      { key: "lfoot", base: "Lead_Foot_Segment_Angle", title: "Lead foot", description: "Lead foot segment angle." },
      { key: "tfoot", base: "Trail_Foot_Segment_Angle", title: "Trail foot", description: "Trail foot segment angle." },
    ],
  },
];

function buildGroups(trials: SwingTrial[], session: SessionMeans): SegmentGroup[] {
  const look = trials.map((t) => t.lookup);
  const avg = (xs: Array<number | null>) => {
    const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const groups: SegmentGroup[] = [];
  for (const g of BACKBONE) {
    const segments: SegmentBlock[] = [];
    for (const seg of g.segments) {
      const events = [...new Set(look.flatMap((L) => L.eventsFor(seg.base)))];
      const rows: SegmentRow[] = events.map((ev) => {
        const name = `${seg.base}@${ev}`;
        const comp = (c: Comp) => avg(look.map((L) => L.comp(name, c)));
        const X = comp("X") ?? (seg.base.includes("Knee") ? session.get(name) ?? null : null);
        const Y = comp("Y");
        const Z = comp("Z");
        const value = X == null && Y == null && Z == null ? avg(look.map((L) => L.z(name))) : null;
        return { event: ev, label: EVENT_LABEL[ev] ?? ev.replace(/_/g, " "), X, Y, Z, value };
      }).filter((r) => r.X != null || r.Y != null || r.Z != null || r.value != null);
      const peaks = (seg.peaks ?? [])
        .map(([k, label, unit]) => ({ label, unit, value: avg(look.map((L) => L.scalar(k))) }))
        .filter((p): p is { label: string; unit: string; value: number } => p.value != null);
      if (rows.length || peaks.length) {
        segments.push({ key: seg.key, title: seg.title, description: seg.description, unit: seg.unit ?? "°", rows, peaks });
      }
    }
    if (segments.length) groups.push({ title: g.title, intro: g.intro, segments });
  }
  return groups;
}

/** Rows written by the swing-metrics loader (the 3D skeleton backfill stores frames instead). */
const HAS_PROCESSED = `EXISTS (SELECT 1 FROM jsonb_object_keys(t.metrics::jsonb) k WHERE k LIKE 'PROCESSED.%')`;

export async function listHittingSessions(athleteUuid: string): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ d: string }>>(
    `SELECT DISTINCT t.session_date::text AS d FROM public.f_hitting_trials t
      WHERE t.athlete_uuid = $1 AND jsonb_typeof(t.metrics::jsonb) = 'object' AND ${HAS_PROCESSED}
      ORDER BY d DESC`,
    athleteUuid,
  );
  return rows.map((r) => r.d);
}

/** Null when the athlete has no hitting captures (or not on `date`). */
export async function buildHittingReport(athleteUuid: string, date?: string | null): Promise<HittingReport | null> {
  const sessions = await listHittingSessions(athleteUuid);
  if (!sessions.length) return null;
  const sessionDate = date && sessions.includes(date) ? date : sessions[0]!;

  const [athlete, trialRows, kin] = await Promise.all([
    prisma.d_athletes.findUnique({ where: { athlete_uuid: athleteUuid }, select: { name: true, height: true, weight: true } }),
    prisma.$queryRawUnsafe<Array<{ trial_index: number; metrics: Record<string, unknown>; age: number | null; height: number | null; weight: number | null }>>(
      `SELECT t.trial_index, t.metrics, t.age_at_collection::float8 AS age, t.height::float8 AS height, t.weight::float8 AS weight
         FROM public.f_hitting_trials t
        WHERE t.athlete_uuid = $1 AND t.session_date = $2::date AND jsonb_typeof(t.metrics::jsonb) = 'object' AND ${HAS_PROCESSED}
        ORDER BY t.trial_index`,
      athleteUuid,
      sessionDate,
    ),
    prisma.$queryRawUnsafe<Array<{ metric_name: string; value: number | null }>>(
      `SELECT metric_name, value::float8 AS value FROM public.f_kinematics_hitting
        WHERE athlete_uuid = $1 AND session_date = $2::date AND frame = 1`,
      athleteUuid,
      sessionDate,
    ).catch(() => []),
  ]);
  if (!athlete || !trialRows.length) return null;

  const session: SessionMeans = new Map();
  for (const k of kin) {
    if (k.value == null) continue;
    const name = k.metric_name.slice(k.metric_name.indexOf(".") + 1).replace(/_MEAN$/, "");
    if (!session.has(name)) session.set(name, k.value);
  }
  const trials: SwingTrial[] = trialRows.map((t) => ({ trialIndex: t.trial_index, lookup: new HitLookup(t.metrics ?? {}) }));
  const metrics = extractSwing(trials, session);
  const first = trialRows[0]!;
  const age = first.age != null ? Math.round(first.age * 10) / 10 : null;
  const firstName = athlete.name.split(/\s+/)[0] ?? athlete.name;
  const variables = new Set(trials.flatMap((t) => [...t.lookup.names]));

  return {
    athlete: {
      athleteUuid,
      name: athlete.name,
      age,
      heightIn: athlete.height != null ? Number(athlete.height) : first.height,
      weightLb: athlete.weight != null ? Number(athlete.weight) : first.weight,
    },
    sessionDate,
    sessions,
    metrics,
    read: writeSwingRead(firstName, metrics, age),
    groups: buildGroups(trials, session),
    variableCount: variables.size,
  };
}
