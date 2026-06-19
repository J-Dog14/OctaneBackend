import { prisma } from "@/lib/db/prisma";
import { decimalToNumber } from "@/lib/octane/utils";
import type {
  ReadinessDashboardPayload,
  AthleteInfo,
  IsoPayload,
  JumpPayload,
  JumpTimeseriesPoint,
  ScoreHistoryEntry,
  PowerCurvePoint,
  GripPoint,
  MovementStrategyPoint,
  IntraSessionEntry,
  TodayVsBaselineEntry,
  FlagHeatmap,
} from "@/app/dashboard/readiness-screen/types";

const FLAG_HEATMAP_DAYS = 14;

// ─── ISO ──────────────────────────────────────────────────────────────────────

async function fetchIso(athleteUuid: string): Promise<IsoPayload> {
  const [iRows, yRows, tRows, ir90Rows] = await Promise.all([
    prisma.f_readiness_screen_i.findMany({
      where: { athlete_uuid: athleteUuid },
      select: { session_date: true, avg_force: true, max_force: true, time_to_max: true },
      orderBy: { session_date: "asc" },
    }),
    prisma.f_readiness_screen_y.findMany({
      where: { athlete_uuid: athleteUuid },
      select: { session_date: true, avg_force: true, max_force: true, time_to_max: true },
      orderBy: { session_date: "asc" },
    }),
    prisma.f_readiness_screen_t.findMany({
      where: { athlete_uuid: athleteUuid },
      select: { session_date: true, avg_force: true, max_force: true, time_to_max: true },
      orderBy: { session_date: "asc" },
    }),
    prisma.f_readiness_screen_ir90.findMany({
      where: { athlete_uuid: athleteUuid },
      select: { session_date: true, avg_force: true, max_force: true, time_to_max: true },
      orderBy: { session_date: "asc" },
    }),
  ]);

  function mapIso(rows: typeof iRows) {
    // Average trials within the same session_date
    const byDate = new Map<string, { avg_force: number[]; max_force: number[]; time_to_max: number[] }>();
    for (const r of rows) {
      const d = r.session_date instanceof Date ? r.session_date.toISOString().slice(0, 10) : String(r.session_date);
      if (!byDate.has(d)) byDate.set(d, { avg_force: [], max_force: [], time_to_max: [] });
      const entry = byDate.get(d)!;
      const af = decimalToNumber(r.avg_force);
      const mf = decimalToNumber(r.max_force);
      const ttm = decimalToNumber(r.time_to_max);
      if (af !== null) entry.avg_force.push(af);
      if (mf !== null) entry.max_force.push(mf);
      if (ttm !== null) entry.time_to_max.push(ttm);
    }
    return Array.from(byDate.entries()).map(([date, v]) => ({
      date,
      avg_force: v.avg_force.length > 0 ? v.avg_force.reduce((a, b) => a + b, 0) / v.avg_force.length : null,
      max_force: v.max_force.length > 0 ? v.max_force.reduce((a, b) => a + b, 0) / v.max_force.length : null,
      time_to_max: v.time_to_max.length > 0 ? v.time_to_max.reduce((a, b) => a + b, 0) / v.time_to_max.length : null,
    }));
  }

  return {
    I:    { legacy: true,  data: mapIso(iRows) },
    Y:    { legacy: false, data: mapIso(yRows) },
    T:    { legacy: true,  data: mapIso(tRows) },
    IR90: { legacy: false, data: mapIso(ir90Rows) },
  };
}

// ─── CMJ / PPU ────────────────────────────────────────────────────────────────

type RawJumpRow = {
  session_date: Date;
  jump_height: number | null;
  pp_w_per_kg: number | null;
  pp_forceplate: number | null;
  force_at_pp: number | null;
  vel_at_pp: number | null;
  source_system: string;
};

type RawPeerRow = {
  force_at_pp: number | null;
  vel_at_pp: number | null;
};

async function fetchJump(athleteUuid: string, kind: "cmj" | "ppu"): Promise<JumpPayload> {
  const rsTable = `f_readiness_screen_${kind}`;
  const athTable = `f_athletic_screen_${kind}`;

  // Union readiness screen + athletic screen for this athlete
  const tsRows = await prisma.$queryRawUnsafe<RawJumpRow[]>(
    `
    SELECT session_date,
           AVG(jump_height)::float   AS jump_height,
           AVG(pp_w_per_kg)::float   AS pp_w_per_kg,
           AVG(pp_forceplate)::float AS pp_forceplate,
           AVG(force_at_pp)::float   AS force_at_pp,
           AVG(vel_at_pp)::float     AS vel_at_pp,
           source_system
      FROM (
        SELECT session_date, jump_height, pp_w_per_kg,
               pp_forceplate, force_at_pp, vel_at_pp, source_system
          FROM public.${rsTable}
         WHERE athlete_uuid = $1
        UNION ALL
        SELECT session_date, jh_in AS jump_height, pp_w_per_kg,
               NULL::numeric AS pp_forceplate, force_at_pp, vel_at_pp, source_system
          FROM public.${athTable}
         WHERE athlete_uuid = $1
      ) _u
     GROUP BY session_date, source_system
     ORDER BY session_date
    `,
    athleteUuid,
  );

  const timeseries: JumpTimeseriesPoint[] = tsRows.map((r) => ({
    date:          r.session_date instanceof Date ? r.session_date.toISOString().slice(0, 10) : String(r.session_date),
    jump_height:   r.jump_height,
    pp_w_per_kg:   r.pp_w_per_kg,
    pp_forceplate: r.pp_forceplate,
    force_at_pp:   r.force_at_pp,
    vel_at_pp:     r.vel_at_pp,
    source:        r.source_system,
  }));

  const scatter = timeseries
    .filter((p) => p.force_at_pp !== null && p.vel_at_pp !== null)
    .map((p) => ({ date: p.date, force_at_pp: p.force_at_pp, vel_at_pp: p.vel_at_pp }));

  // Peer data from both tables (other athletes)
  const peerRows = await prisma.$queryRawUnsafe<RawPeerRow[]>(
    `
    SELECT AVG(force_at_pp)::float AS force_at_pp,
           AVG(vel_at_pp)::float   AS vel_at_pp
      FROM (
        SELECT athlete_uuid, session_date, force_at_pp, vel_at_pp
          FROM public.${rsTable}
         WHERE athlete_uuid <> $1
           AND force_at_pp IS NOT NULL AND vel_at_pp IS NOT NULL
        UNION ALL
        SELECT athlete_uuid, session_date, force_at_pp, vel_at_pp
          FROM public.${athTable}
         WHERE athlete_uuid <> $1
           AND force_at_pp IS NOT NULL AND vel_at_pp IS NOT NULL
      ) _u
     GROUP BY athlete_uuid, session_date
     LIMIT 1500
    `,
    athleteUuid,
  );

  const peers = peerRows
    .filter((r) => r.force_at_pp !== null && r.vel_at_pp !== null)
    .map((r) => ({ force_at_pp: r.force_at_pp as number, vel_at_pp: r.vel_at_pp as number }));

  return { timeseries, scatter, peers };
}

// ─── Score History ────────────────────────────────────────────────────────────

async function fetchScoreHistory(athleteUuid: string): Promise<ScoreHistoryEntry[]> {
  const rows = await prisma.f_readiness_screen_score.findMany({
    where: { athlete_uuid: athleteUuid },
    orderBy: { session_date: "asc" },
  });

  return rows.map((r) => ({
    date:            r.session_date instanceof Date ? r.session_date.toISOString().slice(0, 10) : String(r.session_date),
    composite_score: decimalToNumber(r.composite_score),
    composite_z:     decimalToNumber(r.composite_z),
    band:            r.band,
    cmj_z:           decimalToNumber(r.cmj_z),
    ppu_z:           decimalToNumber(r.ppu_z),
    iso_z:           decimalToNumber(r.iso_z),
    power_curve_z:   decimalToNumber(r.power_curve_z),
    grip_z:          decimalToNumber(r.grip_z),
    metrics_used:    r.metrics_used,
    flags:           r.flags_json as Record<string, unknown> | null,
    scoring_tier:    r.scoring_tier,
  }));
}

// ─── Power Curves ─────────────────────────────────────────────────────────────

type RawPowerCurveRow = {
  session_date: Date;
  peak_power_w: number | null;
  rpd_max: number | null;
  rise_slope: number | null;
  fwhm: number | null;
  auc_j: number | null;
  decay: number | null;
};

async function fetchPowerCurves(athleteUuid: string): Promise<{ CMJ: PowerCurvePoint[]; PPU: PowerCurvePoint[] }> {
  const [cmjRows, ppuRows] = await Promise.all([
    prisma.$queryRawUnsafe<RawPowerCurveRow[]>(
      `
      SELECT session_date,
             AVG(peak_power_w)::float    AS peak_power_w,
             AVG(rpd_max_w_per_s)::float AS rpd_max,
             AVG(rise_slope_w_per_s)::float AS rise_slope,
             AVG(fwhm_s)::float          AS fwhm,
             AVG(auc_j)::float           AS auc_j,
             AVG(decay_90_10_s)::float   AS decay
        FROM (
          SELECT session_date, peak_power_w, rpd_max_w_per_s,
                 rise_slope_w_per_s, fwhm_s, auc_j, decay_90_10_s
            FROM public.f_readiness_screen_power_curve
           WHERE athlete_uuid = $1 AND movement_type = 'CMJ'
          UNION ALL
          SELECT session_date, peak_power_w, rpd_max_w_per_s,
                 NULL::numeric AS rise_slope_w_per_s, fwhm_s, auc_j, decay_90_10_s
            FROM public.f_athletic_screen_cmj
           WHERE athlete_uuid = $1 AND peak_power_w IS NOT NULL
        ) _u
       GROUP BY session_date
       ORDER BY session_date
      `,
      athleteUuid,
    ),
    prisma.$queryRawUnsafe<RawPowerCurveRow[]>(
      `
      SELECT session_date,
             AVG(peak_power_w)::float    AS peak_power_w,
             AVG(rpd_max_w_per_s)::float AS rpd_max,
             AVG(rise_slope_w_per_s)::float AS rise_slope,
             AVG(fwhm_s)::float          AS fwhm,
             AVG(auc_j)::float           AS auc_j,
             AVG(decay_90_10_s)::float   AS decay
        FROM (
          SELECT session_date, peak_power_w, rpd_max_w_per_s,
                 rise_slope_w_per_s, fwhm_s, auc_j, decay_90_10_s
            FROM public.f_readiness_screen_power_curve
           WHERE athlete_uuid = $1 AND movement_type = 'PPU'
          UNION ALL
          SELECT session_date, peak_power_w, rpd_max_w_per_s,
                 NULL::numeric AS rise_slope_w_per_s, fwhm_s, auc_j, decay_90_10_s
            FROM public.f_athletic_screen_ppu
           WHERE athlete_uuid = $1 AND peak_power_w IS NOT NULL
        ) _u
       GROUP BY session_date
       ORDER BY session_date
      `,
      athleteUuid,
    ),
  ]);

  function mapPc(rows: RawPowerCurveRow[]): PowerCurvePoint[] {
    return rows.map((r) => ({
      date:         r.session_date instanceof Date ? r.session_date.toISOString().slice(0, 10) : String(r.session_date),
      peak_power_w: r.peak_power_w,
      rpd_max:      r.rpd_max,
      rise_slope:   r.rise_slope,
      fwhm:         r.fwhm,
      auc_j:        r.auc_j,
      decay:        r.decay,
    }));
  }

  return { CMJ: mapPc(cmjRows), PPU: mapPc(ppuRows) };
}

// ─── Grip ──────────────────────────────────────────────────────────────────────

async function fetchGrip(athleteUuid: string): Promise<GripPoint[]> {
  const rows = await prisma.f_readiness_screen_grip.findMany({
    where: { athlete_uuid: athleteUuid },
    select: {
      session_date: true,
      left_kg: true,
      right_kg: true,
      avg_kg: true,
      max_kg: true,
      asymmetry_pct: true,
    },
    orderBy: { session_date: "asc" },
  });

  return rows.map((r) => ({
    date:          r.session_date instanceof Date ? r.session_date.toISOString().slice(0, 10) : String(r.session_date),
    left_kg:       decimalToNumber(r.left_kg),
    right_kg:      decimalToNumber(r.right_kg),
    avg_kg:        decimalToNumber(r.avg_kg),
    max_kg:        decimalToNumber(r.max_kg),
    asymmetry_pct: decimalToNumber(r.asymmetry_pct),
  }));
}

// ─── Movement Strategy ────────────────────────────────────────────────────────

type RawStrategyRow = {
  session_date: Date;
  mrsi: number | null;
  contraction_time_s: number | null;
  ecc_con_duration_ratio: number | null;
  eccentric_mean_power_w: number | null;
  concentric_duration_s: number | null;
  peak_grf_bw_ratio: number | null;
  rfd_0_100ms: number | null;
  concentric_impulse_ns: number | null;
};

async function fetchMovementStrategy(athleteUuid: string): Promise<{ cmj: MovementStrategyPoint[]; ppu: MovementStrategyPoint[] }> {
  const [cmjRows, ppuRows] = await Promise.all([
    prisma.$queryRawUnsafe<RawStrategyRow[]>(
      `
      SELECT session_date,
             AVG(mrsi)::float                     AS mrsi,
             AVG(contraction_time_s)::float       AS contraction_time_s,
             AVG(ecc_con_duration_ratio)::float   AS ecc_con_duration_ratio,
             AVG(eccentric_mean_power_w)::float   AS eccentric_mean_power_w,
             AVG(concentric_duration_s)::float    AS concentric_duration_s,
             AVG(peak_grf_bw_ratio)::float        AS peak_grf_bw_ratio,
             AVG(rfd_0_100ms)::float              AS rfd_0_100ms,
             AVG(concentric_impulse_ns)::float    AS concentric_impulse_ns
        FROM public.f_readiness_screen_cmj
       WHERE athlete_uuid = $1 AND mrsi IS NOT NULL
       GROUP BY session_date
       ORDER BY session_date
      `,
      athleteUuid,
    ),
    prisma.$queryRawUnsafe<RawStrategyRow[]>(
      `
      SELECT session_date,
             AVG(mrsi)::float                     AS mrsi,
             AVG(contraction_time_s)::float       AS contraction_time_s,
             AVG(ecc_con_duration_ratio)::float   AS ecc_con_duration_ratio,
             AVG(eccentric_mean_power_w)::float   AS eccentric_mean_power_w,
             AVG(concentric_duration_s)::float    AS concentric_duration_s,
             AVG(peak_grf_bw_ratio)::float        AS peak_grf_bw_ratio,
             AVG(rfd_0_100ms)::float              AS rfd_0_100ms,
             AVG(concentric_impulse_ns)::float    AS concentric_impulse_ns
        FROM public.f_readiness_screen_ppu
       WHERE athlete_uuid = $1 AND mrsi IS NOT NULL
       GROUP BY session_date
       ORDER BY session_date
      `,
      athleteUuid,
    ),
  ]);

  function mapStrategy(rows: RawStrategyRow[]): MovementStrategyPoint[] {
    return rows.map((r) => ({
      date:                   r.session_date instanceof Date ? r.session_date.toISOString().slice(0, 10) : String(r.session_date),
      mrsi:                   r.mrsi,
      contraction_time_s:     r.contraction_time_s,
      ecc_con_duration_ratio: r.ecc_con_duration_ratio,
      eccentric_mean_power_w: r.eccentric_mean_power_w,
      concentric_duration_s:  r.concentric_duration_s,
      peak_grf_bw_ratio:      r.peak_grf_bw_ratio,
      rfd_0_100ms:            r.rfd_0_100ms,
      concentric_impulse_ns:  r.concentric_impulse_ns,
    }));
  }

  return { cmj: mapStrategy(cmjRows), ppu: mapStrategy(ppuRows) };
}

// ─── Intra-session Trials ─────────────────────────────────────────────────────

type RawTrialRow = {
  session_date: Date;
  trial_name: string | null;
  jump_height: number | null;
  peak_power_w: number | null;
  mrsi: number | null;
};

async function fetchIntraSession(athleteUuid: string): Promise<{ cmj: IntraSessionEntry[]; ppu: IntraSessionEntry[] }> {
  const [cmjRows, ppuRows] = await Promise.all([
    prisma.$queryRawUnsafe<RawTrialRow[]>(
      `
      SELECT session_date, trial_name,
             jump_height::float AS jump_height,
             peak_power_w::float AS peak_power_w,
             mrsi::float AS mrsi
        FROM public.f_readiness_screen_cmj
       WHERE athlete_uuid = $1
       ORDER BY session_date DESC, trial_name
       LIMIT 120
      `,
      athleteUuid,
    ),
    prisma.$queryRawUnsafe<RawTrialRow[]>(
      `
      SELECT session_date, trial_name,
             jump_height::float AS jump_height,
             peak_power_w::float AS peak_power_w,
             mrsi::float AS mrsi
        FROM public.f_readiness_screen_ppu
       WHERE athlete_uuid = $1
       ORDER BY session_date DESC, trial_name
       LIMIT 120
      `,
      athleteUuid,
    ),
  ]);

  function groupByDate(rows: RawTrialRow[]): IntraSessionEntry[] {
    const byDate = new Map<string, { trial: string | null; jump_height: number | null; peak_power_w: number | null; mrsi: number | null }[]>();
    for (const r of rows) {
      const d = r.session_date instanceof Date ? r.session_date.toISOString().slice(0, 10) : String(r.session_date);
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push({
        trial:        r.trial_name,
        jump_height:  r.jump_height,
        peak_power_w: r.peak_power_w,
        mrsi:         r.mrsi,
      });
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, trials]) => ({ date, trials }));
  }

  return { cmj: groupByDate(cmjRows), ppu: groupByDate(ppuRows) };
}

// ─── Derived: Today vs Baseline ───────────────────────────────────────────────

function deriveToVsBaseline(latestScore: ScoreHistoryEntry | null): TodayVsBaselineEntry[] {
  if (!latestScore?.flags) return [];
  try {
    const flags = latestScore.flags as { per_metric?: Record<string, Record<string, unknown>> };
    const perMetric = flags.per_metric ?? {};
    return Object.entries(perMetric).map(([label, m]) => ({
      metric:    label,
      group:     label.includes(".") ? label.split(".")[0]! : label,
      label,
      today:     (m.today as number) ?? null,
      mean:      (m.mean as number) ?? null,
      sd:        (m.sd as number) ?? null,
      z:         (m.z as number) ?? null,
      flag:      (m.flag as string) ?? null,
      n_history: (m.n_history as number) ?? 0,
    }));
  } catch {
    return [];
  }
}

// ─── Derived: Flag Heatmap ────────────────────────────────────────────────────

function deriveFlagHeatmap(scoreHistory: ScoreHistoryEntry[]): FlagHeatmap {
  const recent = scoreHistory.slice(-FLAG_HEATMAP_DAYS);
  if (recent.length === 0) return { dates: [], metrics: [], cells: [] };

  const allMetrics: string[] = [];
  const metricSet = new Set<string>();
  const dateFlagMap = new Map<string, Record<string, string>>();

  for (const session of recent) {
    const d = session.date;
    const flags = session.flags as { per_metric?: Record<string, { flag?: string }> } | null;
    const perMetric = flags?.per_metric ?? {};
    const rowFlags: Record<string, string> = {};
    for (const [key, m] of Object.entries(perMetric)) {
      rowFlags[key] = m.flag ?? "stable";
      if (!metricSet.has(key)) {
        metricSet.add(key);
        allMetrics.push(key);
      }
    }
    dateFlagMap.set(d, rowFlags);
  }

  const dates = recent.map((s) => s.date);
  const cells = dates.map((d) => {
    const rowFlags = dateFlagMap.get(d) ?? {};
    return allMetrics.map((m) => rowFlags[m] ?? null);
  });

  return { dates, metrics: allMetrics, cells };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function buildReadinessPayload(athleteUuid: string): Promise<ReadinessDashboardPayload> {
  const athleteRow = await prisma.d_athletes.findUnique({
    where: { athlete_uuid: athleteUuid },
    select: { athlete_uuid: true, name: true, age_group: true, gender: true },
  });

  if (!athleteRow) {
    throw new Error(`Athlete not found: ${athleteUuid}`);
  }

  const athlete: AthleteInfo = {
    athlete_uuid: athleteRow.athlete_uuid,
    name:         athleteRow.name,
    age_group:    athleteRow.age_group,
    gender:       athleteRow.gender,
  };

  const [iso, cmj, ppu, scoreHistory, powerCurves, grip, movementStrategy, intraSession] =
    await Promise.all([
      fetchIso(athleteUuid),
      fetchJump(athleteUuid, "cmj"),
      fetchJump(athleteUuid, "ppu"),
      fetchScoreHistory(athleteUuid),
      fetchPowerCurves(athleteUuid),
      fetchGrip(athleteUuid),
      fetchMovementStrategy(athleteUuid),
      fetchIntraSession(athleteUuid),
    ]);

  const latestScore = scoreHistory.length > 0 ? scoreHistory[scoreHistory.length - 1]! : null;
  const todayVsBaseline = deriveToVsBaseline(latestScore);
  const flagHeatmap = deriveFlagHeatmap(scoreHistory);

  return {
    athlete,
    iso,
    cmj,
    ppu,
    score_history:     scoreHistory,
    latest_score:      latestScore,
    power_curves:      powerCurves,
    grip:              { timeseries: grip },
    movement_strategy: movementStrategy,
    intra_session:     intraSession,
    today_vs_baseline: todayVsBaseline,
    flag_heatmap:      flagHeatmap,
  };
}
