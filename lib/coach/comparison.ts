import type { CoachAthleteSummary, CoachTabId } from "./summary";
import type { DomainId } from "@/lib/athlete-tracking/types";

export type ComparisonScope = CoachTabId | "all";
export const COMPARISON_LABELS: Record<ComparisonScope, string> = {
  all: "All areas", overview: "Overview", pitching: "Pitching", biomechanics: "Biomechanics",
  assessments: "Athletic Screen", mobility: "Mobility", prosup: "Pro/Sup",
  curveball: "Curveball", readiness: "Readiness", proteus: "Proteus", program: "Program Lift", throwing: "Program Throwing",
};
export const TRACKING_DOMAINS: DomainId[] = ["pitching", "hitting", "mobility", "athleticScreen", "armAction", "proteus"];
export function isComparisonScope(value: string): value is ComparisonScope {
  return Object.hasOwn(COMPARISON_LABELS, value);
}
export function comparisonDomains(scope: ComparisonScope): DomainId[] {
  switch (scope) {
    case "all": case "overview": return TRACKING_DOMAINS;
    case "biomechanics": return ["pitching", "hitting", "armAction"];
    case "assessments": return ["athleticScreen"];
    case "mobility": return ["mobility"];
    case "proteus": return ["proteus"];
    default: return [];
  }
}
export function hasComparisonData(summary: CoachAthleteSummary, scope: ComparisonScope): boolean {
  if (scope === "all" || scope === "overview") return true;
  if (scope === "pitching") return summary.sources.some((s) => ["savant", "trackman", "pitchReports"].includes(s.id) && s.sessions > 0);
  return summary.tabs[scope];
}

export function parseComparisonIds(raw: string | null, athleteUuid: string): string[] {
  return [...new Set((raw ?? "").split(",").map((id) => id.trim()))]
    .filter((id) => /^[A-Za-z0-9-]{1,64}$/.test(id) && id !== athleteUuid).slice(0, 3);
}
export const comparisonParam = (tab: CoachTabId) => `vs_${tab}`;
export function selectedComparisonIds(params: URLSearchParams, tab: CoachTabId | "compare", athleteUuid: string): string[] {
  const key = tab === "compare" ? "vs" : comparisonParam(tab);
  return parseComparisonIds(params.get(params.has(key) ? key : "vs"), athleteUuid);
}
export function applyComparisonToAll(params: URLSearchParams, ids: string[]): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const tab of Object.keys(COMPARISON_LABELS)) {
    if (tab !== "all") next.delete(comparisonParam(tab as CoachTabId));
  }
  if (ids.length) next.set("vs", ids.join(","));
  else next.delete("vs");
  return next;
}
