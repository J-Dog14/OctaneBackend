// ─── ISO ─────────────────────────────────────────────────────────────────────

export type IsoDataPoint = {
  date: string;
  avg_force: number | null;
  max_force: number | null;
  time_to_max: number | null;
};

export type IsoSeries = {
  legacy: boolean;
  data: IsoDataPoint[];
};

export type IsoPayload = {
  I: IsoSeries;
  Y: IsoSeries;
  T: IsoSeries;
  IR90: IsoSeries;
};

// ─── CMJ / PPU ───────────────────────────────────────────────────────────────

export type JumpTimeseriesPoint = {
  date: string;
  jump_height: number | null;
  pp_w_per_kg: number | null;
  pp_forceplate: number | null;
  force_at_pp: number | null;
  vel_at_pp: number | null;
  source: string;
};

export type FvScatterPoint = {
  date: string;
  force_at_pp: number | null;
  vel_at_pp: number | null;
};

export type PeerPoint = {
  force_at_pp: number;
  vel_at_pp: number;
};

export type JumpPayload = {
  timeseries: JumpTimeseriesPoint[];
  scatter: FvScatterPoint[];
  peers: PeerPoint[];
};

// ─── Score ───────────────────────────────────────────────────────────────────

export type ScoreHistoryEntry = {
  date: string;
  composite_score: number | null;
  composite_z: number | null;
  band: string | null;
  cmj_z: number | null;
  ppu_z: number | null;
  iso_z: number | null;
  power_curve_z: number | null;
  grip_z: number | null;
  metrics_used: number | null;
  flags: Record<string, unknown> | null;
  scoring_tier: string | null;
};

// ─── Power Curves ─────────────────────────────────────────────────────────────

export type PowerCurvePoint = {
  date: string;
  peak_power_w: number | null;
  rpd_max: number | null;
  rise_slope: number | null;
  fwhm: number | null;
  auc_j: number | null;
  decay: number | null;
};

// ─── Grip ────────────────────────────────────────────────────────────────────

export type GripPoint = {
  date: string;
  left_kg: number | null;
  right_kg: number | null;
  avg_kg: number | null;
  max_kg: number | null;
  asymmetry_pct: number | null;
};

// ─── Movement Strategy ───────────────────────────────────────────────────────

export type MovementStrategyPoint = {
  date: string;
  mrsi: number | null;
  contraction_time_s: number | null;
  ecc_con_duration_ratio: number | null;
  eccentric_mean_power_w: number | null;
  concentric_duration_s: number | null;
  peak_grf_bw_ratio: number | null;
  rfd_0_100ms: number | null;
  concentric_impulse_ns: number | null;
};

// ─── Intra-session trials ─────────────────────────────────────────────────────

export type TrialPoint = {
  trial: string | null;
  jump_height: number | null;
  peak_power_w: number | null;
  mrsi: number | null;
};

export type IntraSessionEntry = {
  date: string;
  trials: TrialPoint[];
};

// ─── Today vs Baseline ───────────────────────────────────────────────────────

export type TodayVsBaselineEntry = {
  metric: string;
  group: string;
  label: string;
  today: number | null;
  mean: number | null;
  sd: number | null;
  z: number | null;
  flag: string | null;
  n_history: number;
};

// ─── Flag Heatmap ─────────────────────────────────────────────────────────────

export type FlagHeatmap = {
  dates: string[];
  metrics: string[];
  cells: (string | null)[][];
};

// ─── Full Payload ─────────────────────────────────────────────────────────────

export type AthleteInfo = {
  athlete_uuid: string;
  name: string;
  age_group: string | null;
  gender: string | null;
};

export type ReadinessDashboardPayload = {
  athlete: AthleteInfo;
  iso: IsoPayload;
  cmj: JumpPayload;
  ppu: JumpPayload;
  score_history: ScoreHistoryEntry[];
  latest_score: ScoreHistoryEntry | null;
  power_curves: { CMJ: PowerCurvePoint[]; PPU: PowerCurvePoint[] };
  grip: { timeseries: GripPoint[] };
  movement_strategy: { cmj: MovementStrategyPoint[]; ppu: MovementStrategyPoint[] };
  intra_session: { cmj: IntraSessionEntry[]; ppu: IntraSessionEntry[] };
  today_vs_baseline: TodayVsBaselineEntry[];
  flag_heatmap: FlagHeatmap;
};
