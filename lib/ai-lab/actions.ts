/**
 * AI Lab action registry — every button on /dashboard/ai-lab is one entry.
 *
 * Each action declares its parameters (which the page renders as a form) and
 * builds an argv for `python -m src.main …` in the OctaneAiLayer repo (or a
 * UAIS script for data pulls). Processes are spawned with shell:false and
 * every value is validated against its declared kind first, so nothing typed
 * into the page can become shell syntax.
 *
 * To expose a new CLI command: add an entry here. Nothing else changes.
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";

export type Category = "athlete" | "first" | "compare" | "group" | "archetype" | "maintenance";

type Base = { name: string; label: string; help?: string; required?: boolean };
export type ParamSpec =
  | (Base & { kind: "athlete" })
  | (Base & { kind: "athletes"; min: number; max: number })
  | (Base & { kind: "date"; default?: "today" | "weekAgo" })
  | (Base & { kind: "enum"; options: { value: string; label: string }[]; default?: string })
  | (Base & { kind: "multi"; options: { value: string; label: string }[]; default?: string[] })
  | (Base & { kind: "int"; min: number; max: number; default?: number })
  | (Base & { kind: "float"; min: number; max: number; step?: number; default?: number })
  | (Base & { kind: "bool"; default?: boolean })
  | (Base & { kind: "token"; placeholder?: string })
  | (Base & { kind: "skill"; filter?: "athlete" | "first" | "any"; default?: string })
  | (Base & { kind: "dir"; placeholder?: string });

export type ActionDef = {
  id: string;
  label: string;
  category: Category;
  description: string;
  params: ParamSpec[];
  /** argv after the interpreter. */
  build: (p: Values) => string[];
  target?: "ai" | "uais";
  /** Shown in a confirm() before running — population-wide or slow jobs. */
  confirm?: string;
  /** Highlight as the primary action of its category. */
  primary?: boolean;
};

export type Values = Record<string, string | number | boolean | string[] | undefined>;

// ── shared option lists ─────────────────────────────────────────────────────
const AGE_GROUPS = ["YOUTH", "HIGH SCHOOL", "COLLEGE", "PRO"].map((v) => ({ value: v, label: v }));
const ROLES = ["pitcher", "hitter", "both", "all"].map((v) => ({ value: v, label: v }));
const DOMAINS = [
  "pitching_3d", "hitting_3d", "force_plate", "mobility", "proteus_pitcher", "proteus_hitter",
  "athletic_screen", "athletic_screen_cmj", "athletic_screen_dj", "athletic_screen_ppu",
  "athletic_screen_slv", "readiness_screen", "arm_action", "curveball_test",
].map((v) => ({ value: v, label: v }));

const age: ParamSpec = { name: "age_group", label: "Level", kind: "enum", options: AGE_GROUPS };
const role = (d = "pitcher"): ParamSpec => ({ name: "role", label: "Role", kind: "enum", options: ROLES, default: d });
const minDate: ParamSpec = { name: "min_as_of_date", label: "Ignore profiles before", kind: "date",
  help: "e.g. to drop pre-2024 mobility scale data" };
const exMob: ParamSpec = { name: "exclude_mobility", label: "Exclude mobility", kind: "bool" };
const minN = (d: number): ParamSpec => ({ name: "min_n", label: "Min n", kind: "int", min: 3, max: 500, default: d });
const fdr: ParamSpec = { name: "fdr_alpha", label: "FDR alpha", kind: "float", min: 0.01, max: 0.5, step: 0.01, default: 0.1 };
const athlete: ParamSpec = { name: "athlete", label: "Athlete", kind: "athlete", required: true };
const session: ParamSpec = { name: "session", label: "Session", kind: "date",
  help: "per-session skills default to the latest session" };
const rawDir: ParamSpec = { name: "raw_dir", label: "Raw export folder (optional)", kind: "dir",
  placeholder: "C:\\...\\Qualisys\\Athlete\\2026-09-22",
  help: "json/csv/xml copied into the packet (e.g. B_Young metadata.json + results.json)" };
const withC3d: ParamSpec = { name: "with_c3d", label: "Also copy .c3d files", kind: "bool" };

/** --flag value, only when the value is present. */
function opt(flag: string, v: unknown): string[] {
  if (v === undefined || v === null || v === "" || v === false) return [];
  if (v === true) return [flag];
  if (Array.isArray(v)) return v.flatMap((x) => [flag, String(x)]);
  return [flag, String(v)];
}
const s = (v: unknown) => String(v);

// ── the registry ────────────────────────────────────────────────────────────
export const ACTIONS: ActionDef[] = [
  // ─ athlete ─
  {
    id: "wb-pipeline", category: "athlete", primary: true,
    label: "Run everything → skill packet",
    description: "Rebuild stale profiles, regenerate the coach report if needed, and build the packet for the chosen skill (optionally run it headlessly).",
    params: [athlete, { name: "skill", label: "Skill", kind: "skill", filter: "athlete", default: "mover-profile", required: true },
      session, rawDir, withC3d,
      { name: "headless", label: "Run the skill headlessly (API)", kind: "bool", help: "mover-profile only; needs AI_LAYER_HEADLESS=1" }],
    build: (p) => ["-m", "src.main", "wb", "pipeline", s(p.athlete), "--skill", s(p.skill),
      ...opt("--session", p.session), ...opt("--raw-dir", p.raw_dir), ...opt("--with-c3d", p.with_c3d),
      ...opt("--headless", p.headless)],
  },
  {
    id: "wb-prepare", category: "athlete", label: "Build missing / stale AI profiles",
    description: "Only the dates whose source data changed since the profile was built (e.g. Proteus landed overnight).",
    params: [athlete, { name: "force", label: "Rebuild every date", kind: "bool" },
      { name: "dry_run", label: "Dry run", kind: "bool" }],
    build: (p) => ["-m", "src.main", "wb", "prepare", s(p.athlete), ...opt("--force", p.force), ...opt("--dry-run", p.dry_run)],
  },
  {
    id: "wb-coach-report", category: "athlete", label: "Coach report",
    description: "Rebuilt only when the profiles changed since the last one (or when forced / focused).",
    params: [athlete, { name: "focus_session", label: "Focus session", kind: "date" },
      { name: "force", label: "Force rebuild", kind: "bool" }],
    build: (p) => ["-m", "src.main", "wb", "coach-report", s(p.athlete),
      ...opt("--focus-session", p.focus_session), ...opt("--force", p.force)],
  },
  {
    id: "wb-packet", category: "athlete", label: "Build skill packet only",
    description: "Folder + zip with warehouse rows, profiles, coach report/parsed JSON and a Cowork prompt.",
    params: [athlete, { name: "skill", label: "Skill", kind: "skill", filter: "any", default: "mover-profile", required: true },
      session, rawDir, withC3d],
    build: (p) => ["-m", "src.main", "wb", "packet", s(p.athlete), "--skill", s(p.skill),
      ...opt("--session", p.session), ...opt("--raw-dir", p.raw_dir), ...opt("--with-c3d", p.with_c3d)],
  },
  {
    id: "wb-queue-add", category: "athlete", label: "Queue for after tonight's Proteus / mobility",
    description: "The morning workbench job builds the packet once the chosen sources have a session within ±14 days of the latest capture.",
    params: [athlete, { name: "skill", label: "Skill", kind: "skill", filter: "any", default: "mover-profile", required: true },
      session,
      { name: "wait_for", label: "Wait for", kind: "multi", default: ["proteus", "mobility"],
        options: [{ value: "proteus", label: "Proteus" }, { value: "mobility", label: "Mobility" }, { value: "screen", label: "Athletic screen" }] },
      { name: "max_wait_days", label: "Give up waiting after (days)", kind: "int", min: 0, max: 30, default: 5 },
      { name: "headless", label: "Run headlessly when ready", kind: "bool" }],
    build: (p) => ["-m", "src.main", "wb", "queue", "add", s(p.athlete), "--skill", s(p.skill),
      ...opt("--session", p.session), ...opt("--wait-for", p.wait_for),
      ...opt("--max-wait-days", p.max_wait_days), ...opt("--headless", p.headless)],
  },
  {
    id: "research-diagnose", category: "athlete", label: "Diagnose missing data",
    description: "Wrong DB branch, duplicate athlete record, not ingested, or partially ingested — which one.",
    params: [athlete],
    build: (p) => ["-m", "src.main", "research", "diagnose", s(p.athlete)],
  },
  {
    id: "research-unit-audit", category: "athlete", label: "Unit audit",
    description: "Find metrics whose units changed between captures (a 100× jump is not athletic change).",
    params: [athlete],
    build: (p) => ["-m", "src.main", "research", "unit-audit", s(p.athlete)],
  },
  {
    id: "show-profile", category: "athlete", label: "Show a profile snapshot",
    description: "Raw values and z-scores for one as-of date.",
    params: [athlete, { name: "as_of", label: "As of", kind: "date", required: true },
      { name: "only", label: "Only", kind: "enum", options: [{ value: "raw", label: "raw" }, { value: "z", label: "z" }] }],
    build: (p) => ["-m", "src.main", "show-profile", s(p.athlete), s(p.as_of), ...opt("--only", p.only)],
  },
  {
    id: "wb-render-profile", category: "athlete", label: "Render a Cowork profile.json to PDF",
    description: "If Cowork wrote out/profile.json into a packet but no PDF, render it locally (Edge/Chrome) and log it.",
    params: [{ name: "packet", label: "Packet folder name", kind: "token", required: true,
      placeholder: "Ryan_Chasse__mover-profile__20260930_0815" }],
    build: (p) => ["-m", "src.main", "wb", "render-profile", path.join("outputs", "packets", s(p.packet))],
  },

  // ─ first assessment ─
  {
    id: "wb-first-look", category: "first", primary: true,
    label: "First look for a new athlete",
    description: "One assessment round, no history: baseline mover type, level placement and testing-vs-capture convergence.",
    params: [athlete, rawDir, withC3d,
      { name: "headless", label: "Run headlessly (API)", kind: "bool" }],
    build: (p) => ["-m", "src.main", "wb", "pipeline", s(p.athlete), "--skill", "first-look",
      ...opt("--raw-dir", p.raw_dir), ...opt("--with-c3d", p.with_c3d), ...opt("--headless", p.headless)],
  },

  // ─ compare ─
  {
    id: "wb-compare", category: "compare", primary: true, label: "Athlete vs athlete",
    description: "2–4 athletes side by side on their latest AI profile: raw value, position in their own level, z gap.",
    params: [{ name: "athletes", label: "Athletes", kind: "athletes", min: 2, max: 4, required: true },
      { name: "as_of", label: "Profiles as of", kind: "date" }],
    build: (p) => ["-m", "src.main", "wb", "compare", ...(p.athletes as string[]), ...opt("--as-of", p.as_of)],
  },

  // ─ group statistics ─
  {
    id: "research-overview", category: "group", primary: true, label: "Cross-domain overview",
    description: "Every domain against a target domain, FDR-corrected.",
    params: [{ name: "target_domain", label: "Target domain", kind: "enum", options: DOMAINS, default: "pitching_3d" },
      role(), age, minN(8), fdr, minDate, exMob],
    build: (p) => ["-m", "src.main", "research", "overview", ...opt("--target-domain", p.target_domain),
      ...opt("--role", p.role), ...opt("--age-group", p.age_group), ...opt("--min-n", p.min_n),
      ...opt("--fdr-alpha", p.fdr_alpha), ...opt("--min-as-of-date", p.min_as_of_date), ...opt("--exclude-mobility", p.exclude_mobility)],
  },
  {
    id: "research-correlate", category: "group", label: "Correlate one metric",
    description: "Everything against one target metric (e.g. pitch_ball_release_speed).",
    params: [{ name: "target", label: "Target metric key", kind: "token", required: true, placeholder: "pitch_ball_release_speed" },
      role(), age, { name: "method", label: "Method", kind: "enum", default: "spearman",
        options: [{ value: "spearman", label: "spearman" }, { value: "pearson", label: "pearson" }] },
      minN(8), fdr, { name: "by_age_group", label: "Stratify by level", kind: "bool" },
      { name: "exclude_same_domain", label: "Exclude same domain", kind: "bool" }, minDate, exMob],
    build: (p) => ["-m", "src.main", "research", "correlate", s(p.target), ...opt("--role", p.role),
      ...opt("--age-group", p.age_group), ...opt("--method", p.method), ...opt("--min-n", p.min_n),
      ...opt("--fdr-alpha", p.fdr_alpha), ...opt("--by-age-group", p.by_age_group),
      ...opt("--exclude-same-domain", p.exclude_same_domain), ...opt("--min-as-of-date", p.min_as_of_date),
      ...opt("--exclude-mobility", p.exclude_mobility)],
  },
  {
    id: "research-cross", category: "group", label: "Domain × domain",
    description: "Correlation matrix between two domains.",
    params: [{ name: "a", label: "Domain A", kind: "enum", options: DOMAINS, required: true, default: "mobility" },
      { name: "b", label: "Domain B", kind: "enum", options: DOMAINS, required: true, default: "pitching_3d" },
      role(), age, minN(8), fdr, minDate, exMob],
    build: (p) => ["-m", "src.main", "research", "cross", s(p.a), s(p.b), ...opt("--role", p.role),
      ...opt("--age-group", p.age_group), ...opt("--min-n", p.min_n), ...opt("--fdr-alpha", p.fdr_alpha),
      ...opt("--min-as-of-date", p.min_as_of_date), ...opt("--exclude-mobility", p.exclude_mobility)],
  },
  {
    id: "research-velocity-deep", category: "group", label: "Velocity deep dive",
    description: "Within-athlete and pooled drivers of ball speed from trial data.",
    params: [age, { name: "min_velocity", label: "Min mph", kind: "float", min: 40, max: 110, step: 0.5 },
      { name: "max_velocity", label: "Max mph", kind: "float", min: 40, max: 110, step: 0.5 },
      { name: "min_sessions", label: "Min sessions / athlete", kind: "int", min: 1, max: 20, default: 2 },
      { name: "processed_only", label: "Processed trials only", kind: "bool" },
      { name: "exclude_symptomatic", label: "Exclude symptomatic", kind: "bool" }, minDate],
    build: (p) => ["-m", "src.main", "research", "velocity-deep", ...opt("--age-group", p.age_group),
      ...opt("--min-velocity", p.min_velocity), ...opt("--max-velocity", p.max_velocity),
      ...opt("--min-sessions-per-athlete", p.min_sessions), ...opt("--processed-only", p.processed_only),
      ...opt("--exclude-symptomatic", p.exclude_symptomatic), ...opt("--min-as-of-date", p.min_as_of_date)],
  },
  {
    id: "research-session-change", category: "group", label: "What changed when velo changed",
    description: "Session-to-session deltas across athletes, correlated with velocity/GRF deltas.",
    params: [age, { name: "predictor_domain", label: "Predictors", kind: "enum", default: "assessment_baseline",
      options: ["assessment_baseline", "assessment_delta", "kinematic_only", "all"].map((v) => ({ value: v, label: v })) },
      { name: "min_span_days", label: "Min span (days)", kind: "int", min: 1, max: 730, default: 30 },
      { name: "max_span_days", label: "Max span (days)", kind: "int", min: 30, max: 1500, default: 730 },
      minN(5)],
    build: (p) => ["-m", "src.main", "research", "session-change", ...opt("--age-group", p.age_group),
      ...opt("--predictor-domain", p.predictor_domain), ...opt("--min-span-days", p.min_span_days),
      ...opt("--max-span-days", p.max_span_days), ...opt("--min-n", p.min_n)],
  },
  {
    id: "research-longitudinal", category: "group", label: "Longitudinal change",
    description: "Athletes with repeat profiles: what moved, and program response.",
    params: [role(), minN(6), { name: "skip_program_response", label: "Skip program response", kind: "bool" }],
    build: (p) => ["-m", "src.main", "research", "longitudinal", ...opt("--role", p.role),
      ...opt("--min-n", p.min_n), ...opt("--skip-program-response", p.skip_program_response)],
  },
  {
    id: "research-stratified-chain", category: "group", label: "Stratified kinetic chain",
    description: "Top kinematic drivers per level and what testing predicts them.",
    params: [{ name: "top_k", label: "Top k", kind: "int", min: 1, max: 20, default: 5 },
      { name: "aggregation", label: "Aggregation", kind: "enum", default: "mean",
        options: ["mean", "median", "max"].map((v) => ({ value: v, label: v })) }, fdr, minDate, exMob],
    build: (p) => ["-m", "src.main", "research", "stratified-chain", ...opt("--top-k", p.top_k),
      ...opt("--aggregation", p.aggregation), ...opt("--fdr-alpha", p.fdr_alpha),
      ...opt("--min-as-of-date", p.min_as_of_date), ...opt("--exclude-mobility", p.exclude_mobility)],
  },
  {
    id: "research-roster", category: "group", label: "Roster (who needs looking at)",
    description: "The squad sorted by attention score, linked to each athlete's latest coach report.",
    params: [age, { name: "limit", label: "Top N", kind: "int", min: 1, max: 500 },
      { name: "min_sessions", label: "Min sessions", kind: "int", min: 1, max: 20, default: 1 }],
    build: (p) => ["-m", "src.main", "research", "roster", ...opt("--age-group", p.age_group),
      ...opt("--limit", p.limit), ...opt("--min-sessions", p.min_sessions)],
  },
  {
    id: "research-coverage", category: "group", label: "Data coverage",
    description: "How many athletes have each domain — check before trusting a group stat.",
    params: [role("all"), age, minDate, exMob],
    build: (p) => ["-m", "src.main", "research", "coverage", ...opt("--role", p.role),
      ...opt("--age-group", p.age_group), ...opt("--min-as-of-date", p.min_as_of_date), ...opt("--exclude-mobility", p.exclude_mobility)],
  },

  // ─ archetypes ─
  {
    id: "wb-taxonomy", category: "archetype", primary: true, label: "Mover types by level",
    description: "Applies the mover-profile classification rules to every athlete with a current profile.",
    params: [minDate],
    build: (p) => ["-m", "src.main", "wb", "taxonomy", ...opt("--min-date", p.min_as_of_date)],
  },
  {
    id: "research-clusters", category: "archetype", label: "Data-driven clusters",
    description: "k-means archetypes from the profile matrix (k auto if blank).",
    params: [{ name: "k", label: "k", kind: "int", min: 2, max: 12 }, role(), age,
      { name: "domains", label: "Domains", kind: "multi", options: DOMAINS },
      { name: "min_coverage", label: "Min coverage", kind: "float", min: 0.1, max: 1, step: 0.05, default: 0.5 },
      minDate, exMob],
    build: (p) => ["-m", "src.main", "research", "clusters", ...opt("--k", p.k), ...opt("--role", p.role),
      ...opt("--age-group", p.age_group), ...opt("--domain", p.domains), ...opt("--min-coverage", p.min_coverage),
      ...opt("--min-as-of-date", p.min_as_of_date), ...opt("--exclude-mobility", p.exclude_mobility)],
  },
  {
    id: "wb-ledger", category: "archetype", label: "Mover-profile ledger summary",
    description: "Every logged mover profile: type counts, velocity by type, which metrics separate types.",
    params: [],
    build: () => ["-m", "src.main", "wb", "ledger"],
  },
  {
    id: "legacy-report", category: "archetype", label: "Correlation / archetype report (v1)",
    description: "The original clustering + correlation HTML report.",
    params: [{ name: "k", label: "k", kind: "int", min: 2, max: 12, default: 5 },
      { name: "role", label: "Role", kind: "enum", default: "pitcher", options: ["pitcher", "hitter", "all"].map((v) => ({ value: v, label: v })) },
      { name: "domain", label: "Domain", kind: "enum", default: "all",
        options: ["all", "movement", "mobility", "performance", "functional"].map((v) => ({ value: v, label: v })) }],
    build: (p) => ["-m", "src.main", "report", ...opt("--k", p.k), ...opt("--role", p.role), ...opt("--domain", p.domain)],
  },

  // ─ maintenance ─
  {
    id: "uais-proteus-pull", category: "maintenance", target: "uais", primary: true,
    label: "Pull Proteus now (date range)",
    description: "Runs the nightly Proteus download + ETL on demand instead of waiting for tomorrow's run.",
    params: [{ name: "start", label: "From", kind: "date", required: true, default: "weekAgo" },
      { name: "end", label: "To", kind: "date", required: true, default: "today" }],
    build: (p) => [path.join("python", "proteus", "main.py"), "--start", s(p.start), "--end", s(p.end)],
  },
  {
    id: "uais-mobility-pull", category: "maintenance", target: "uais",
    label: "Pull mobility sheets now",
    description: "Runs the nightly Google Drive mobility import on demand (only new files are processed).",
    params: [],
    build: () => [path.join("python", "mobility", "main.py")],
  },
  {
    id: "wb-nightly", category: "maintenance", label: "Run the morning job now",
    description: "Refresh stale profiles for athletes with data in the last N days, then work through the queue.",
    params: [{ name: "since_days", label: "Athletes active in last (days)", kind: "int", min: 1, max: 120, default: 10 },
      { name: "skip_queue", label: "Skip queue", kind: "bool" }],
    build: (p) => ["-m", "src.main", "wb", "nightly", ...opt("--since-days", p.since_days), ...opt("--skip-queue", p.skip_queue)],
  },
  {
    id: "wb-queue-run", category: "maintenance", label: "Process the queue",
    description: "Build every queued packet whose sources have landed.",
    params: [],
    build: () => ["-m", "src.main", "wb", "queue", "run"],
  },
  {
    id: "wb-queue-remove", category: "maintenance", label: "Remove a queue entry",
    description: "By id (shown in the queue list).",
    params: [{ name: "id", label: "Entry id", kind: "token", required: true }],
    build: (p) => ["-m", "src.main", "wb", "queue", "remove", s(p.id)],
  },
  {
    id: "norms", category: "maintenance", label: "Refresh population norms",
    description: "Rebuild ai_layer.assessment_norms. Changes every z-score — rebuild profiles after.",
    params: [], confirm: "Refresh norms for the whole population?",
    build: () => ["-m", "src.main", "norms"],
  },
  {
    id: "cohort-refresh", category: "maintenance", label: "Refresh cohort statistics",
    description: "Recompute the group-level findings every coach report reads.",
    params: [{ name: "top_k", label: "Top k", kind: "int", min: 1, max: 20, default: 5 },
      { name: "dry_run", label: "Dry run", kind: "bool" }],
    build: (p) => ["-m", "src.main", "research", "cohort-refresh", ...opt("--top-k", p.top_k), ...opt("--dry-run", p.dry_run)],
  },
  {
    id: "backfill", category: "maintenance", label: "Backfill every profile",
    description: "Rebuild ai_layer.athlete_profiles for the whole population. Slow.",
    params: [{ name: "latest_only", label: "Latest date per athlete only", kind: "bool" }],
    confirm: "Rebuild profiles for every athlete? This takes a while.",
    build: (p) => ["-m", "src.main", "backfill", ...opt("--latest-only", p.latest_only)],
  },
  {
    id: "sync", category: "maintenance", label: "Snapshot the App DB",
    description: "Refresh app_db_snapshot.* (users, programs, exercises).",
    params: [], confirm: "Snapshot the App DB now?",
    build: () => ["-m", "src.main", "sync"],
  },
  {
    id: "summarize-all", category: "maintenance", label: "Summarize every program",
    description: "Rebuild program_summaries + program_exercise_prescriptions from the snapshot.",
    params: [], confirm: "Re-summarize every program?",
    build: () => ["-m", "src.main", "summarize-all"],
  },
  {
    id: "reliability-gaps", category: "maintenance", label: "Reliability gaps",
    description: "Which metrics have no repeat-capture data (verdicts fall back to provisional bands).",
    params: [], build: () => ["-m", "src.main", "research", "reliability", "--gaps"],
  },
  {
    id: "metric-coverage", category: "maintenance", label: "Metric dictionary coverage",
    description: "Metrics that still need a coach-facing name.",
    params: [{ name: "status", label: "Status", kind: "enum", default: "raw",
      options: ["all", "raw", "auto", "curated"].map((v) => ({ value: v, label: v })) }],
    build: (p) => ["-m", "src.main", "research", "metric-coverage", ...opt("--status", p.status)],
  },
  {
    id: "apply-migration", category: "maintenance", label: "Apply research migration",
    description: "Create/upgrade the research tables (idempotent).",
    params: [], build: () => ["-m", "src.main", "research", "apply-migration"],
  },
  {
    id: "cost", category: "maintenance", label: "LLM spend",
    description: "Gemini cost from ai_layer.llm_call_log.",
    params: [], build: () => ["-m", "src.main", "cost"],
  },
];

export const ACTIONS_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

// ── validation ─────────────────────────────────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[A-Za-z0-9_.\-]{1,120}$/;
const SKILL = /^[a-z0-9][a-z0-9-]{0,59}$/;

function isoDay(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

export function defaultFor(p: ParamSpec): Values[string] {
  if (p.kind === "date") return p.default === "today" ? isoDay(0) : p.default === "weekAgo" ? isoDay(-7) : undefined;
  return "default" in p ? p.default : undefined;
}

/** Returns clean values or throws Error(message) naming the bad field. */
export function validateParams(action: ActionDef, raw: Record<string, unknown>): Values {
  const out: Values = {};
  for (const p of action.params) {
    const v = raw[p.name];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (p.required) throw new Error(`${p.label} is required`);
      continue;
    }
    const bad = (why = "invalid") => new Error(`${p.label}: ${why}`);
    switch (p.kind) {
      case "athlete":
        if (typeof v !== "string" || !UUID.test(v)) throw bad("pick an athlete from the list");
        out[p.name] = v;
        break;
      case "athletes": {
        if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && UUID.test(x))) throw bad();
        const uniq = Array.from(new Set(v as string[]));
        if (uniq.length < p.min || uniq.length > p.max) throw bad(`pick ${p.min}–${p.max} different athletes`);
        out[p.name] = uniq;
        break;
      }
      case "date":
        if (typeof v !== "string" || !ISO.test(v) || Number.isNaN(Date.parse(v))) throw bad("expected YYYY-MM-DD");
        out[p.name] = v;
        break;
      case "enum":
        if (typeof v !== "string" || !p.options.some((o) => o.value === v)) throw bad();
        out[p.name] = v;
        break;
      case "multi": {
        if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && p.options.some((o) => o.value === x))) throw bad();
        out[p.name] = Array.from(new Set(v as string[]));
        break;
      }
      case "int": {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isInteger(n) || n < p.min || n > p.max) throw bad(`whole number ${p.min}–${p.max}`);
        out[p.name] = n;
        break;
      }
      case "float": {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n) || n < p.min || n > p.max) throw bad(`number ${p.min}–${p.max}`);
        out[p.name] = n;
        break;
      }
      case "bool":
        if (v === true || v === "true") out[p.name] = true;
        break;
      case "token":
        if (typeof v !== "string" || !TOKEN.test(v) || v.startsWith("-") || v.includes("..")) throw bad("letters, digits, _ . - only");
        out[p.name] = v;
        break;
      case "skill":
        if (typeof v !== "string" || !SKILL.test(v)) throw bad();
        out[p.name] = v;
        break;
      case "dir": {
        if (typeof v !== "string" || !path.isAbsolute(v) || v.startsWith("-")) throw bad("absolute folder path");
        let ok = false;
        try { ok = existsSync(v) && statSync(v).isDirectory(); } catch { ok = false; }
        if (!ok) throw bad("folder not found on this machine");
        out[p.name] = v;
        break;
      }
    }
  }
  return out;
}

/** What the page needs to draw forms (functions stripped). */
export function publicActions() {
  return ACTIONS.map(({ build: _b, ...rest }) => ({
    ...rest,
    params: rest.params.map((p) => ({ ...p, resolvedDefault: defaultFor(p) })),
  }));
}
