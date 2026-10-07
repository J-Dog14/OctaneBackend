import type { Category } from "@/lib/ai-lab/actions";

export type Option = { value: string; label: string };

export type PublicParam = {
  name: string;
  label: string;
  kind: "athlete" | "athletes" | "date" | "enum" | "multi" | "int" | "float" | "bool" | "token" | "skill" | "dir";
  help?: string;
  required?: boolean;
  options?: Option[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  filter?: "athlete" | "first" | "any";
  resolvedDefault?: string | number | boolean | string[];
};

export type PublicAction = {
  id: string;
  label: string;
  category: Category;
  description: string;
  params: PublicParam[];
  target?: "ai" | "uais";
  confirm?: string;
  primary?: boolean;
};

export type SkillInfo = {
  id: string;
  label: string;
  description: string;
  cowork_command: string | null;
  per_session: boolean;
  headless: boolean;
  category: string;
};

export type AiLabConfigResponse = {
  ready: boolean;
  root: string | null;
  python: boolean;
  uaisPython: boolean;
  problems: string[];
  actions: PublicAction[];
  skills: SkillInfo[];
  headless: { enabled: boolean; flag: boolean; api_key: boolean; sdk: boolean; model: string; pdf_engine: string | null } | null;
};

export type StepState = "done" | "todo" | "waiting" | "blocked" | "optional";

export type ArtifactRef = { path: string; name: string; modified: string };

export type AthleteStatus = {
  athlete: { athlete_uuid: string; name: string; email?: string; age_group?: string | null };
  sources: { key: string; table: string; n_sessions: number; n_rows: number; first: string | null; latest: string | null; dates: string[] }[];
  profiles: { as_of_date: string; state: "missing" | "stale" | "current"; changed: string[]; profile_id: number | null; built_at: string | null }[];
  orphan_profiles: string[];
  rounds: { capture: string; proteus: string | null; mobility: string | null; screen: string | null; force_plate: string | null }[];
  steps: { key: string; label: string; state: StepState; detail: string }[];
  artifacts: { coach_reports: ArtifactRef[]; mover_pdfs: ArtifactRef[]; packets: ArtifactRef[]; compares: ArtifactRef[] };
  ledger: Record<string, unknown>[];
  queue: QueueEntry[];
  session_dates: string[];
  norms_computed_at: string | null;
  cohort_computed_at: string | null;
  nightly?: {
    proteus: { file: string; at: string } | null;
    mobility: { file: string; at: string } | null;
    workbench: { at: string } | null;
  };
};

export type QueueEntry = {
  id: string;
  athlete_uuid: string;
  name: string;
  skill: string;
  session: string | null;
  wait_for: string[];
  status: "pending" | "waiting" | "done" | "failed";
  message: string | null;
  packet: string | null;
  added_at: string;
  last_run?: string;
};

export type Values = Record<string, string | number | boolean | string[] | undefined>;

export const fileUrl = (rel: string, download = false) =>
  `/api/dashboard/ai-lab/file?path=${encodeURIComponent(rel)}${download ? "&download=1" : ""}`;
