/**
 * Athlete header for the coach suite: demographics, what data exists and how
 * recent it is, plus the small per-session histories (pro-sup, curveball test)
 * that don't have an athlete-tracking domain.
 */

import { prisma } from "@/lib/db/prisma";
import { getDb } from "@/lib/pitch-intel/db";
import { getTrackingSessionDates } from "@/lib/athlete-tracking/sessionDates";
import { programSummary } from "@/lib/coach/program";
import { clientForAthlete } from "@/lib/client-hub/repository";
import type { DomainId } from "@/lib/athlete-tracking/types";

export type CoachTabId = "overview" | "pitching" | "biomechanics" | "hitting" | "assessments" | "mobility" | "prosup" | "curveball" | "readiness" | "proteus" | "program" | "throwing" | "programManagement";

export interface DataSource {
  id: string;
  label: string;
  tab: CoachTabId;
  sessions: number;
  lastDate: string | null;
}

export interface CoachAthleteSummary {
  athlete: {
    athleteUuid: string;
    name: string;
    dateOfBirth: string | null;
    age: number | null;
    ageGroup: string | null;
    gender: string | null;
    /** Display string, e.g. `6'4"`. */
    height: string | null;
    /** Display string, e.g. "215 lb". */
    weight: string | null;
    throws: "L" | "R" | null;
    level: string | null;
  };
  sources: DataSource[];
  /** Tracking domains that have data (drives which domain panels render). */
  trackingDomains: DomainId[];
  /** Session dates per tracking domain, newest first. */
  trackingDates: Partial<Record<DomainId, string[]>>;
  tabs: Record<CoachTabId, boolean>;
  /** Client Hub record (coach.hub_clients), when this athlete has ever been on an 8ctane program. */
  hubClient: { id: string; status: string; isActive: boolean } | null;
}

export interface ProSupSession {
  date: string;
  totalScore: number | null;
  totRom: number | null;
  forearmRom: number | null;
  flips: number | null;
  avgVelo: number | null;
  fatigueScore: number | null;
  consistencyPenalty: number | null;
  seasonPhase: string | null;
}

export interface CurveballSession {
  date: string;
  pitches: number;
  avgStability: number | null;
  bestStability: number | null;
  pitchTypes: string[];
}

/** pitch_intel.* may not exist yet on a fresh database; treat it as no data. */
function pitchIntelMissing(err: unknown): never[] {
  if (String(err).includes("does not exist")) return [];
  throw err;
}

const num = (v: unknown) => (v == null ? null : Math.round(Number(v) * 100) / 100);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

function ageFrom(dob: Date | null): number | null {
  if (!dob) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

const DOMAIN_SOURCE: Record<DomainId, { label: string; tab: CoachTabId }> = {
  pitching: { label: "Pitching 3D", tab: "biomechanics" },
  hitting: { label: "Hitting 3D", tab: "hitting" },
  armAction: { label: "Arm action", tab: "biomechanics" },
  athleticScreen: { label: "Athletic screen", tab: "assessments" },
  mobility: { label: "Mobility", tab: "mobility" },
  proteus: { label: "Proteus", tab: "proteus" },
};

/** Null when the athlete doesn't exist. */
/**
 * Display height, e.g. 76.00004104 -> `6'4"`. Heights arrive in inches, some
 * converted from QTM's metric values with float noise; a value that looks like
 * centimetres (120-230) is converted. Implausible values are hidden.
 */
export function formatHeight(v: number | null): string | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  const inches = v >= 120 && v <= 230 ? v / 2.54 : v;
  if (inches < 36 || inches > 96) return null;
  let ft = Math.floor(inches / 12);
  let rest = Math.round(inches - ft * 12);
  if (rest === 12) {
    ft += 1;
    rest = 0;
  }
  return `${ft}'${rest}"`;
}

/** Display weight in whole pounds, e.g. 214.99898473494 -> "215 lb". */
export function formatWeight(v: number | null): string | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  return `${Math.round(v)} lb`;
}

export async function getCoachAthleteSummary(athleteUuid: string): Promise<CoachAthleteSummary | null> {
  const a = await prisma.d_athletes.findUnique({
    where: { athlete_uuid: athleteUuid },
    select: {
      athlete_uuid: true, name: true, date_of_birth: true, age: true, age_group: true, gender: true, height: true, weight: true,
    },
  });
  if (!a) return null;

  const conn = await getDb();
  const [trackingDates, readiness, proSup, curveball, links, savant, trackman, reports, program, hubClient] = await Promise.all([
    getTrackingSessionDates(athleteUuid),
    prisma.v_readiness_screen_sessions.aggregate({ where: { athlete_uuid: athleteUuid }, _count: { _all: true }, _max: { session_date: true } }),
    prisma.f_pro_sup.aggregate({ where: { athlete_uuid: athleteUuid }, _count: { _all: true }, _max: { session_date: true } }),
    prisma.f_curveball_test.aggregate({ where: { athlete_uuid: athleteUuid }, _count: { _all: true }, _max: { session_date: true } }),
    conn.query<{ source: string; throws: string | null; level: string | null; league: string | null }>(
      `SELECT source, throws, level, league FROM pitch_intel.athlete_source_links WHERE athlete_uuid = $1 ORDER BY (source = 'savant') DESC, id`,
      athleteUuid,
    ).catch(pitchIntelMissing),
    conn.query<{ n: number; last: string | null }>(
      `SELECT count(DISTINCT game_pk)::int AS n, max(game_date)::text AS last FROM pitch_intel.savant_pitches WHERE athlete_uuid = $1`,
      athleteUuid,
    ).catch(pitchIntelMissing),
    conn.query<{ n: number; last: string | null }>(
      `SELECT count(DISTINCT (session_date, session_type))::int AS n, max(session_date)::text AS last FROM pitch_intel.trackman_pitches WHERE athlete_uuid = $1`,
      athleteUuid,
    ).catch(pitchIntelMissing),
    conn.query<{ n: number; last: string | null }>(
      `SELECT count(*)::int AS n, max(COALESCE(report_date, created_at::date))::text AS last FROM pitch_intel.aggregate_reports WHERE athlete_uuid = $1`,
      athleteUuid,
    ).catch(pitchIntelMissing),
    // 8ctane app programs (App DB snapshot); missing snapshot → no Program tab.
    programSummary(athleteUuid).catch(() => ({ lift: 0, throwing: 0, lastLift: null, lastThrowing: null })),
    clientForAthlete(athleteUuid).catch(() => null),
  ]);

  const sources: DataSource[] = [
    { id: "savant", label: "Savant games", tab: "pitching", sessions: savant[0]?.n ?? 0, lastDate: savant[0]?.last ?? null },
    { id: "trackman", label: "Trackman sessions", tab: "pitching", sessions: trackman[0]?.n ?? 0, lastDate: trackman[0]?.last ?? null },
    { id: "pitchReports", label: "Pitch reports", tab: "pitching", sessions: reports[0]?.n ?? 0, lastDate: reports[0]?.last ?? null },
    ...trackingDates.map((d) => ({
      id: d.domainId,
      label: DOMAIN_SOURCE[d.domainId].label,
      tab: DOMAIN_SOURCE[d.domainId].tab,
      sessions: d.dates.length,
      lastDate: d.dates[0] ?? null,
    })),
    { id: "proSup", label: "Pro-sup", tab: "prosup", sessions: proSup._count._all, lastDate: day(proSup._max.session_date) },
    { id: "curveball", label: "Curveball test", tab: "curveball", sessions: curveball._count._all, lastDate: day(curveball._max.session_date) },
    { id: "readiness", label: "Readiness", tab: "readiness", sessions: readiness._count._all, lastDate: day(readiness._max.session_date) },
    { id: "program", label: "Program lift days", tab: "program", sessions: program.lift, lastDate: program.lastLift },
    { id: "programThrowing", label: "Program throwing days", tab: "throwing", sessions: program.throwing, lastDate: program.lastThrowing },
  ];
  const present = sources.filter((s) => s.sessions > 0);
  const has = (tab: CoachTabId) => present.some((s) => s.tab === tab);

  const throwsRaw = links.find((l) => l.throws)?.throws ?? null;
  const savantLink = links.find((l) => l.source === "savant");
  return {
    athlete: {
      athleteUuid: a.athlete_uuid,
      name: a.name,
      dateOfBirth: day(a.date_of_birth),
      age: ageFrom(a.date_of_birth) ?? (a.age == null ? null : Math.floor(Number(a.age))),
      ageGroup: a.age_group ?? null,
      gender: a.gender ?? null,
      height: formatHeight(a.height == null ? null : Number(a.height)),
      weight: formatWeight(a.weight == null ? null : Number(a.weight)),
      throws: throwsRaw === "L" || throwsRaw === "R" ? throwsRaw : null,
      level: savantLink?.league || savantLink?.level || links.find((l) => l.level)?.level || null,
    },
    sources: present.sort((x, y) => (y.lastDate ?? "").localeCompare(x.lastDate ?? "")),
    trackingDomains: trackingDates.map((d) => d.domainId),
    trackingDates: Object.fromEntries(trackingDates.map((d) => [d.domainId, d.dates])),
    tabs: {
      overview: true,
      pitching: has("pitching") || links.length > 0,
      biomechanics: has("biomechanics"),
      hitting: has("hitting"),
      assessments: has("assessments"),
      mobility: has("mobility"),
      prosup: has("prosup"),
      curveball: has("curveball"),
      readiness: has("readiness"),
      proteus: has("proteus"),
      program: has("program"),
      throwing: has("throwing"),
      // Anyone in the Client Hub (active, paused or expired), so a returning client's history is one click away.
      programManagement: !!hubClient,
    },
    hubClient,
  };
}

export async function getProSupHistory(athleteUuid: string): Promise<ProSupSession[]> {
  const rows = await prisma.f_pro_sup.findMany({
    where: { athlete_uuid: athleteUuid },
    orderBy: { session_date: "desc" },
    take: 12,
    select: {
      session_date: true, total_score: true, tot_rom: true, forearm_rom: true, num_of_flips: true, avg_velo: true,
      total_fatigue_score: true, consistency_penalty: true, season_phase: true,
    },
  });
  return rows.map((r) => ({
    date: day(r.session_date)!,
    totalScore: num(r.total_score),
    totRom: num(r.tot_rom),
    forearmRom: num(r.forearm_rom),
    flips: num(r.num_of_flips),
    avgVelo: num(r.avg_velo),
    fatigueScore: num(r.total_fatigue_score),
    consistencyPenalty: num(r.consistency_penalty),
    seasonPhase: r.season_phase ?? null,
  }));
}

export async function getCurveballHistory(athleteUuid: string): Promise<CurveballSession[]> {
  const rows = await prisma.f_curveball_test.findMany({
    where: { athlete_uuid: athleteUuid },
    orderBy: { session_date: "desc" },
    take: 200,
    select: { session_date: true, pitch_type: true, pitch_stability_score: true },
  });
  const map = new Map<string, { scores: number[]; types: Set<string>; n: number }>();
  for (const r of rows) {
    const d = day(r.session_date)!;
    if (!map.has(d)) map.set(d, { scores: [], types: new Set(), n: 0 });
    const s = map.get(d)!;
    s.n++;
    if (r.pitch_stability_score != null) s.scores.push(Number(r.pitch_stability_score));
    if (r.pitch_type) s.types.add(r.pitch_type);
  }
  return [...map.entries()].map(([date, s]) => ({
    date,
    pitches: s.n,
    avgStability: s.scores.length ? num(s.scores.reduce((x, y) => x + y, 0) / s.scores.length) : null,
    bestStability: s.scores.length ? num(Math.max(...s.scores)) : null,
    pitchTypes: [...s.types],
  }));
}
