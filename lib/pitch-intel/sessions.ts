/**
 * Per-athlete Trackman sessions (bullpens and games) and screenshot reports,
 * summarized by pitch type and graded with xArsenal. Feeds the Sessions page;
 * Ryan's dashboard covers games pitch by pitch.
 */

import { getDb } from "./db";
import { PITCH_LABELS, isPitchCode, type PitchCode } from "./pitch-types";
import { gradeArsenals, xaLevel, type ArsenalGrade, type PitchGrade } from "./xarsenal/worker";

/** Pitches of one type needed in a session to grade it (same as Ryan's per-outing grades). */
export const SESSION_GRADE_MIN = 5;

export interface PitchTypeSummary {
  pitchType: PitchCode;
  label: string;
  count: number | null;
  usagePct: number | null;
  velo: number | null;
  veloMax: number | null;
  spinRate: number | null;
  ivb: number | null;
  /** Arm-side positive, inches. */
  hbArm: number | null;
  extension: number | null;
  relHeight: number | null;
  relSide: number | null;
  /** Savant arm angle (degrees), when the source measures it. */
  armAngle?: number | null;
  vaa: number | null;
  spinEfficiency: number | null;
  whiffPct: number | null;
  /** Swings behind whiffPct (Trackman sessions only; null on screenshot reports). */
  swings: number | null;
  /** xArsenal v3 (20-80) + 8-Stuff+, from Ryan's Worker. */
  grade: PitchGrade | null;
}

export interface SessionSummary {
  date: string;
  sessionType: "game" | "bullpen";
  pitches: number;
  sourceFiles: string[];
  byType: PitchTypeSummary[];
  arsenal: ArsenalGrade | null;
}

export interface ReportSummary {
  id: number;
  source: string;
  date: string | null;
  season: number | null;
  level: string | null;
  title: string | null;
  notes: string | null;
  createdAt: string;
  byType: PitchTypeSummary[];
  arsenal: SessionSummary["arsenal"];
}

export interface AthleteSessions {
  athlete: { athleteUuid: string; name: string; throws: "L" | "R" | null; level: string | null; hasSavant: boolean };
  sessions: SessionSummary[];
  reports: ReportSummary[];
  /** Set when the xArsenal service couldn't be reached (grades are then missing). */
  xaError: string | null;
}

const r1 = (v: unknown) => (v == null ? null : Math.round(Number(v) * 10) / 10);

export interface GradeGroup {
  rows: PitchTypeSummary[];
  throws: "L" | "R" | null;
  level: string | null;
  /** Pitches of a type needed to grade it (0 = grade every row with a velocity). */
  minCount: number;
  /** Savant's release_pos_x is catcher's view: -1 turns it into the pitcher's-right-positive side the Worker wants. */
  relSideSign?: 1 | -1;
  setArsenal: (a: ArsenalGrade | null) => void;
}

/**
 * Grades several pitch-type tables (seasons, sessions, reports) with xArsenal v3 + 8-Stuff+
 * in one call to Ryan's Worker. Returns an error message when the Worker can't be reached
 * (every grade is then null), else null.
 */
export async function gradeGroups(groups: GradeGroup[]): Promise<string | null> {
  const items = groups.map((g, i) => ({
    id: String(i),
    hand: (g.throws ?? "R") as "R" | "L",
    level: xaLevel(g.level),
    pitches: g.rows
      .filter((r) => r.pitchType !== "OTHER" && (r.count == null || r.count >= g.minCount) && r.velo != null && r.ivb != null && r.hbArm != null)
      .map((r) => ({
        key: r.pitchType,
        code: r.pitchType,
        count: r.count,
        velocity: r.velo!,
        spinRate: r.spinRate,
        ivb: r.ivb!,
        // The Worker takes HB as measured (+ = pitcher's right) and mirrors lefties itself.
        hb: g.throws === "L" ? -r.hbArm! : r.hbArm!,
        extension: r.extension,
        vaa: r.vaa,
        armAngle: r.armAngle ?? null,
        releaseHeight: r.relHeight,
        releaseSide: r.relSide == null ? null : r.relSide * (g.relSideSign ?? 1),
        spinEfficiency: r.spinEfficiency,
      })),
  }));
  try {
    const graded = await gradeArsenals(items);
    groups.forEach((g, i) => {
      const res = graded.get(String(i));
      for (const r of g.rows) r.grade = res?.pitches.get(r.pitchType) ?? null;
      g.setArsenal(res?.arsenal ?? null);
    });
    return null;
  } catch (err) {
    console.error("[xarsenal]", err);
    for (const g of groups) {
      for (const r of g.rows) r.grade = null;
      g.setArsenal(null);
    }
    return err instanceof Error ? err.message : String(err);
  }
}

export async function getAthleteSessions(athleteUuid: string): Promise<AthleteSessions | null> {
  const conn = await getDb();
  const athleteRows = await conn.query<{ name: string }>(`SELECT name FROM analytics.d_athletes WHERE athlete_uuid = $1`, athleteUuid);
  if (!athleteRows.length) return null;
  const links = await conn.query<{ source: string; throws: string | null; level: string | null; league: string | null }>(
    `SELECT source, throws, level, league FROM pitch_intel.athlete_source_links WHERE athlete_uuid = $1 ORDER BY (source = 'savant') DESC, id`,
    athleteUuid,
  );
  const savant = links.find((l) => l.source === "savant");
  const throwsRaw = links.find((l) => l.throws)?.throws ?? null;
  const throws = throwsRaw === "L" || throwsRaw === "R" ? throwsRaw : null;
  const level = savant?.league || savant?.level || links.find((l) => l.level)?.level || null;

  // Trackman sessions, one row per date / type / pitch type
  const tm = await conn.query<{
    session_date: string; session_type: "game" | "bullpen"; pitch_type: string; n: number; total: number;
    velo: number | null; velo_max: number | null; spin: number | null; ivb: number | null; hb_arm: number | null;
    ext: number | null; rel_h: number | null; rel_s: number | null; vaa: number | null; spin_eff: number | null;
    swings: number; whiffs: number; files: string[];
  }>(
    `SELECT session_date::text, session_type, pitch_type, count(*)::int AS n,
            (sum(count(*)) OVER (PARTITION BY session_date, session_type))::int AS total,
            avg(rel_speed) AS velo, max(rel_speed) AS velo_max, avg(spin_rate) AS spin, avg(ivb) AS ivb,
            avg(CASE WHEN pitcher_throws = 'L' THEN -hb ELSE hb END) AS hb_arm,
            avg(extension) AS ext, avg(rel_height) AS rel_h, avg(rel_side) AS rel_s, avg(vaa) AS vaa,
            avg(spin_efficiency) AS spin_eff,
            count(*) FILTER (WHERE pitch_call ILIKE '%Swinging%' OR pitch_call ILIKE '%Foul%' OR pitch_call = 'InPlay')::int AS swings,
            count(*) FILTER (WHERE pitch_call ILIKE '%Swinging%')::int AS whiffs,
            array_agg(DISTINCT source_file) AS files
       FROM pitch_intel.trackman_pitches
      WHERE athlete_uuid = $1
      GROUP BY session_date, session_type, pitch_type
      ORDER BY session_date DESC, session_type, n DESC`,
    athleteUuid,
  );
  const sessionMap = new Map<string, SessionSummary>();
  for (const r of tm) {
    const key = `${r.session_date}|${r.session_type}`;
    if (!sessionMap.has(key)) sessionMap.set(key, { date: r.session_date, sessionType: r.session_type, pitches: r.total, sourceFiles: [], byType: [], arsenal: null });
    const s = sessionMap.get(key)!;
    for (const f of r.files ?? []) if (f && !s.sourceFiles.includes(f)) s.sourceFiles.push(f);
    const code = isPitchCode(r.pitch_type) ? r.pitch_type : "OTHER";
    s.byType.push({
      pitchType: code,
      label: PITCH_LABELS[code],
      count: r.n,
      usagePct: r.total ? r1((r.n / r.total) * 100) : null,
      velo: r1(r.velo),
      veloMax: r1(r.velo_max),
      spinRate: r.spin == null ? null : Math.round(Number(r.spin)),
      ivb: r1(r.ivb),
      hbArm: r1(r.hb_arm),
      extension: r1(r.ext),
      relHeight: r1(r.rel_h),
      relSide: r1(r.rel_s),
      vaa: r1(r.vaa),
      spinEfficiency: r.spin_eff == null ? null : Math.round(Number(r.spin_eff)),
      whiffPct: r.swings ? r1((r.whiffs / r.swings) * 100) : null,
      swings: r.swings,
      grade: null,
    });
  }
  const sessions = [...sessionMap.values()];

  // Screenshot reports
  const reportRows = await conn.query<{
    id: number; source: string; report_date: string | null; season: number | null; level: string | null; throws: string | null;
    title: string | null; notes: string | null; created_at: string;
  }>(
    `SELECT id::int AS id, source, report_date::text, season, level, throws, title, notes, created_at::text
       FROM pitch_intel.aggregate_reports WHERE athlete_uuid = $1
      ORDER BY COALESCE(report_date, created_at::date) DESC, id DESC`,
    athleteUuid,
  );
  const pitchRows = reportRows.length
    ? await conn.query<Record<string, unknown> & { report_id: number; pitch_type: string }>(
        `SELECT report_id::int AS report_id, pitch_type, pitch_count, usage_pct, velo, velo_max, spin_rate, ivb, hb_arm,
                extension, rel_height, rel_side, vaa, spin_efficiency, whiff_pct
           FROM pitch_intel.aggregate_pitch_rows WHERE report_id = ANY($1::bigint[]) ORDER BY id`,
        reportRows.map((r) => r.id),
      )
    : [];
  const reports: Array<ReportSummary & { throws: "L" | "R" | null }> = reportRows.map((rep) => {
    const repThrows = rep.throws === "L" || rep.throws === "R" ? rep.throws : throws;
    const byType: PitchTypeSummary[] = pitchRows
      .filter((p) => p.report_id === rep.id)
      .map((p) => {
        const code = isPitchCode(p.pitch_type) ? p.pitch_type : "OTHER";
        return {
          pitchType: code,
          label: PITCH_LABELS[code],
          count: p.pitch_count == null ? null : Number(p.pitch_count),
          usagePct: r1(p.usage_pct),
          velo: r1(p.velo),
          veloMax: r1(p.velo_max),
          spinRate: p.spin_rate == null ? null : Math.round(Number(p.spin_rate)),
          ivb: r1(p.ivb),
          hbArm: r1(p.hb_arm),
          extension: r1(p.extension),
          relHeight: r1(p.rel_height),
          relSide: r1(p.rel_side),
          vaa: r1(p.vaa),
          spinEfficiency: p.spin_efficiency == null ? null : Math.round(Number(p.spin_efficiency)),
          whiffPct: r1(p.whiff_pct),
          swings: null,
          grade: null,
        };
      });
    return {
      id: rep.id,
      source: rep.source,
      date: rep.report_date,
      season: rep.season,
      level: rep.level,
      title: rep.title,
      notes: rep.notes,
      createdAt: rep.created_at,
      byType,
      arsenal: null,
      throws: repThrows,
    };
  });

  const xaError = await gradeGroups([
    ...sessions.map((s): GradeGroup => ({ rows: s.byType, throws, level, minCount: SESSION_GRADE_MIN, setArsenal: (a) => (s.arsenal = a) })),
    // Reports often have no pitch counts; grade every row that has a velocity.
    ...reports.map((r): GradeGroup => ({ rows: r.byType, throws: r.throws, level: r.level || level, minCount: 0, setArsenal: (a) => (r.arsenal = a) })),
  ]);

  return {
    athlete: { athleteUuid, name: athleteRows[0].name, throws, level, hasSavant: !!savant },
    sessions,
    reports: reports.map((r) => {
      const { throws: _drop, ...rest } = r;
      void _drop;
      return rest;
    }),
    xaError,
  };
}
