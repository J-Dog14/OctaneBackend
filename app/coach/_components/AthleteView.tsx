"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { Alert, Badge, Button, CloseButton, Group, Loader, Stack, Tabs, Text, Title, Tooltip } from "@mantine/core";
import type { CoachAthleteSummary, CoachTabId } from "@/lib/coach/summary";
import { SERIES_COLORS } from "@/app/dashboard/athlete-tracking/constants";
import { daysAgo, fmtDate, rememberAthlete, summaryKey, swrOpts, useCoachFetcher } from "./fetcher";
import { AthleteSearchSelect } from "./AthleteSearchSelect";
import { OverviewTab } from "../_tabs/OverviewTab";
// Keep the PDF report's stylesheet in the athlete page's initial CSS bundle.
// Loading this tab dynamically can leave a populated report briefly unstyled
// on navigation or after a development refresh.
import { BiomechanicsTab } from "../_tabs/BiomechanicsTab";
import { useAthletePrefetch } from "./useAthletePrefetch";
import { athleteWarmKeys } from "./prefetch";
import { usePopulationStatus } from "./CoachDataProvider";
import { applyComparisonToAll, COMPARISON_LABELS, comparisonParam, hasComparisonData, parseComparisonIds, selectedComparisonIds, type ComparisonScope } from "@/lib/coach/comparison";

const CompareBody = dynamic(() => import("./CompareView").then((m) => m.CompareBody), { loading: () => <Loader size="sm" /> });
const PitchingTab = dynamic(() => import("../_tabs/PitchingTab").then((m) => m.PitchingTab), { loading: () => <Loader size="sm" /> });
const AthleticScreenTab = dynamic(() => import("../_tabs/AssessmentsTab").then((m) => m.AthleticScreenTab), { loading: () => <Loader size="sm" /> });
const CurveballTab = dynamic(() => import("../_tabs/AssessmentsTab").then((m) => m.CurveballTab), { loading: () => <Loader size="sm" /> });
const MobilityTab = dynamic(() => import("../_tabs/MobilityTab").then((m) => m.MobilityTab), { loading: () => <Loader size="sm" /> });
const ProSupTab = dynamic(() => import("../_tabs/AssessmentsTab").then((m) => m.ProSupTab), { loading: () => <Loader size="sm" /> });
const ReadinessTab = dynamic(() => import("../_tabs/ReadinessTab").then((m) => m.ReadinessTab), { loading: () => <Loader size="sm" /> });
const ProteusTab = dynamic(() => import("../_tabs/ProteusTab").then((m) => m.ProteusTab), { loading: () => <Loader size="sm" /> });
const ProgramTab = dynamic(() => import("../_tabs/ProgramTab").then((m) => m.ProgramTab), { loading: () => <Loader size="sm" /> });
const HittingTab = dynamic(() => import("../_tabs/HittingTab").then((m) => m.HittingTab), { loading: () => <Loader size="sm" /> });
const ThrowingTab = dynamic(() => import("../_tabs/ThrowingTab").then((m) => m.ThrowingTab), { loading: () => <Loader size="sm" /> });
const ProgramManagementTab = dynamic(() => import("../_tabs/ProgramManagementTab").then((m) => m.ProgramManagementTab), { loading: () => <Loader size="sm" /> });

type TabId = CoachTabId | "compare";

const TABS: Array<{ id: CoachTabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "pitching", label: "Pitching" },
  { id: "biomechanics", label: "Biomechanics" },
  { id: "hitting", label: "Hitting" },
  { id: "assessments", label: "Athletic Screen" },
  { id: "mobility", label: "Mobility" },
  { id: "prosup", label: "Pro/Sup" },
  { id: "curveball", label: "Curveball" },
  { id: "readiness", label: "Readiness" },
  { id: "proteus", label: "Proteus" },
  { id: "program", label: "Program Lift" },
  { id: "throwing", label: "Program Throwing" },
  // Athletes in the Client Hub (summary.tabs.programManagement): their client page.
  { id: "programManagement", label: "Program Management" },
];

const MAX_COMPARE = 3; // plus the athlete on the page

function isTab(v: string | null): v is TabId {
  return v === "compare" || (!!v && TABS.some((t) => t.id === v));
}

/** Name chip for an athlete added to the comparison (name comes from its summary). */
function CompareChip({ uuid, index, onRemove, scope }: { uuid: string; index: number; onRemove: () => void; scope: ComparisonScope }) {
  const { data } = useSWR<CoachAthleteSummary>(summaryKey(uuid), swrOpts);
  if (data && !hasComparisonData(data, scope)) return null;
  return (
    <Badge
      size="lg"
      variant="light"
      color="gray"
      style={{ textTransform: "none" }}
      leftSection={<span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 999, background: SERIES_COLORS[index] }} />}
      rightSection={<CloseButton size="xs" aria-label="Remove from comparison" onClick={onRemove} />}
    >
      <Link href={`/coach/athletes/${uuid}`} style={{ color: "inherit", textDecoration: "none" }}>
        {data?.athlete.name ?? "Loading…"}
      </Link>
    </Badge>
  );
}

function Header({
  s,
  vs,
  onAddCompare,
  onRemoveCompare,
  scope,
  shared,
  onApplyAll,
  onUseThisTab,
}: {
  s: CoachAthleteSummary;
  vs: string[];
  onAddCompare: (uuid: string) => void;
  onRemoveCompare: (uuid: string) => void;
  scope: ComparisonScope;
  shared: boolean;
  onApplyAll: () => void;
  onUseThisTab: () => void;
}) {
  const a = s.athlete;
  const [adding, setAdding] = useState(false);
  const facts = [
    a.age != null ? `${a.age} yrs` : null,
    a.ageGroup,
    a.throws ? `${a.throws}HP` : null,
    a.level,
    a.height,
    a.weight,
  ].filter(Boolean);
  const comparing = vs.length > 0;
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <div>
          <Title order={2} style={{ lineHeight: 1.15 }}>
            {comparing && <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 999, background: SERIES_COLORS[0], marginRight: 8, verticalAlign: "middle" }} />}
            {a.name}
          </Title>
          <Text size="sm" c="dimmed" mt={4}>
            {facts.length ? facts.join(" · ") : "No demographics on file"}
          </Text>
        </div>
        <Stack gap={6} align="flex-end">
          <Group gap="xs" wrap="wrap" justify="flex-end">
            {vs.map((uuid, i) => (
              <CompareChip key={uuid} uuid={uuid} index={i + 1} scope={scope} onRemove={() => onRemoveCompare(uuid)} />
            ))}
            {vs.length < MAX_COMPARE &&
              (adding ? (
                <AthleteSearchSelect
                  key={scope}
                  dataScope={scope}
                  value={null}
                  exclude={[a.athleteUuid, ...vs]}
                  placeholder={`Search ${COMPARISON_LABELS[scope].toLowerCase()} athletes…`}
                  size="xs"
                  w={240}
                  onChange={(v) => {
                    if (v) onAddCompare(v);
                    setAdding(false);
                  }}
                />
              ) : (
                <Button variant="light" size="xs" onClick={() => setAdding(true)}>
                  {comparing ? "+ Add athlete" : `Compare ${scope === "all" ? "athletes" : COMPARISON_LABELS[scope]}`}
                </Button>
              ))}
          </Group>
          <Button component={Link} href={`/coach/athletes/${encodeURIComponent(a.athleteUuid)}/download`} variant="subtle" size="xs">
            Download data
          </Button>
        </Stack>
      </Group>
      {comparing && scope !== "all" && <Group gap="xs" mt="sm" justify="flex-end">
        <Text size="xs" c="dimmed">{shared ? "Selection applied across tabs" : `Comparing ${COMPARISON_LABELS[scope]} only`}</Text>
        <Button variant="subtle" size="compact-xs" onClick={shared ? onUseThisTab : onApplyAll}>
          {shared ? "Use only this tab" : "Apply to all comparisons"}
        </Button>
      </Group>}
      <Group gap={6} mt="md">
        {s.sources.length === 0 ? (
          <Text size="sm" c="dimmed">No assessment data yet.</Text>
        ) : (
          s.sources.map((src) => {
            const age = daysAgo(src.lastDate);
            return (
              <Tooltip key={src.id} label={`${src.sessions} session${src.sessions === 1 ? "" : "s"} · last ${fmtDate(src.lastDate)}`}>
                <Badge variant="light" color={age != null && age <= 30 ? "blue" : "gray"} size="md" style={{ textTransform: "none" }}>
                  {src.label} · {age == null ? "—" : age === 0 ? "today" : `${age}d ago`}
                </Badge>
              </Tooltip>
            );
          })
        )}
      </Group>
    </div>
  );
}

function AthleteViewInner({ athleteUuid }: { athleteUuid: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = new URLSearchParams(searchParams.toString());
  const allVs = parseComparisonIds(query.get("vs"), athleteUuid);
  const tabParam = searchParams.get("tab");
  const tab: TabId = isTab(tabParam) && (tabParam !== "compare" || allVs.length > 0) ? tabParam : "overview";
  const { data: summary, error, isLoading } = useSWR<CoachAthleteSummary>(summaryKey(athleteUuid), swrOpts);
  const { cache, mutate } = useSWRConfig();
  const fetcher = useCoachFetcher();
  const activeTab: TabId = tab === "compare" || summary?.tabs[tab] ? tab : "overview";
  const scope: ComparisonScope = activeTab === "compare" ? "all" : activeTab;
  const selectedVs = selectedComparisonIds(query, activeTab, athleteUuid);
  const { data: comparedSummaries } = useSWR(selectedVs.length ? ["coach-compare-eligibility", selectedVs] : null,
    ([, ids]) => Promise.all((ids as string[]).map((id) => fetcher<CoachAthleteSummary>(summaryKey(id)))),
    { revalidateOnFocus: false });
  const vs = comparedSummaries ? selectedVs.filter((id) => comparedSummaries.some((s) => s.athlete.athleteUuid === id && hasComparisonData(s, scope))) : selectedVs;
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const populations = usePopulationStatus();
  useAthletePrefetch(summary, refreshing);

  async function refresh() {
    if (!summary || refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    const prefix = `/api/coach/athletes/${encodeURIComponent(athleteUuid)}/`;
    const keys = [...new Set([summaryKey(athleteUuid), ...athleteWarmKeys(summary),
      ...[...cache.keys()].filter((key) => key.startsWith(prefix))])];
    let failed = false;
    // Refresh cached historical selections too, without a burst of DB requests.
    async function worker() {
      while (keys.length) {
        const key = keys.shift()!;
        try {
          const data = await fetcher(key, { refresh: true });
          await mutate(key, data, { revalidate: false });
        } catch {
          failed = true;
        }
      }
    }
    try {
      await Promise.all([worker(), worker()]);
      await mutate((key) => Array.isArray(key), undefined, { revalidate: true });
      if (failed) setRefreshError("Some data could not be refreshed. Please try again.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (summary) rememberAthlete({ athleteUuid, name: summary.athlete.name });
  }, [summary, athleteUuid]);

  const navigate = (p: URLSearchParams) => router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  const go = (nextTab: TabId) => {
    const p = new URLSearchParams(query);
    if (nextTab === "overview") p.delete("tab");
    else p.set("tab", nextTab);
    navigate(p);
  };
  const setTab = (t: string | null) => isTab(t) && go(t);

  if (isLoading) return <Loader />;
  if (error || !summary) return <Alert color="red">{error?.message ?? "Athlete not found"}</Alert>;

  // Only tabs with data are shown. A link to a tab this athlete has no data for
  // (e.g. ?tab=mobility from another athlete) lands on Overview instead.
  const shownTabs = TABS.filter((t) => summary.tabs[t.id]);
  const shared = allVs.length > 0 && (activeTab === "compare" || !query.has(comparisonParam(activeTab)));
  const setComparison = (next: string[]) => {
    const p = new URLSearchParams(query);
    const key = activeTab === "compare" || (shared && vs.length === selectedVs.length) ? "vs" : comparisonParam(activeTab);
    if (next.length) p.set(key, next.join(","));
    else if (key !== "vs" && allVs.length) p.set(key, "");
    else p.delete(key);
    if (!next.length && activeTab === "compare") p.delete("tab");
    navigate(p);
  };
  const applyAll = () => navigate(applyComparisonToAll(query, vs));
  const useThisTab = () => {
    const p = new URLSearchParams(query);
    p.delete("vs");
    if (activeTab !== "compare") p.set(comparisonParam(activeTab), vs.join(","));
    navigate(p);
  };

  return (
    <Stack gap="md" maw={1280} mx="auto">
      <Header s={summary} vs={vs} scope={scope} shared={shared} onApplyAll={applyAll} onUseThisTab={useThisTab}
        onAddCompare={(uuid) => setComparison([...vs, uuid])} onRemoveCompare={(uuid) => setComparison(vs.filter((id) => id !== uuid))} />
      <Group justify="flex-end">
        <Button variant="subtle" size="xs" loading={refreshing} onClick={() => void refresh()}>Refresh data</Button>
      </Group>
      {refreshError && <Alert color="red">{refreshError}</Alert>}
      {!!populations?.pending && <Text size="xs" c="dimmed">
        {populations.ready === 0 ? "Preparing comparison percentiles. Athlete measurements remain available." : "Comparison percentiles are updating in the background."}
      </Text>}
      <Tabs value={activeTab} onChange={setTab} keepMounted={false} variant="outline">
        <Tabs.List>
          {shownTabs.map((t) => (
            <Tabs.Tab key={t.id} value={t.id}>
              {t.label}
            </Tabs.Tab>
          ))}
          {allVs.length > 0 && (
            <Tabs.Tab value="compare" ml="auto" color="blue">
              All comparisons ({allVs.length + 1})
            </Tabs.Tab>
          )}
        </Tabs.List>
        <div style={{ paddingTop: "1.25rem" }}>
          {vs.length > 0 && activeTab !== "compare" ? <Tabs.Panel value={activeTab}><CompareBody key={scope} ids={[athleteUuid, ...vs]} scope={scope} /></Tabs.Panel> : <>
          <Tabs.Panel value="overview">
            <OverviewTab athleteUuid={athleteUuid} summary={summary} onOpenTab={setTab} />
          </Tabs.Panel>
          <Tabs.Panel value="pitching">
            <PitchingTab athleteUuid={athleteUuid} />
          </Tabs.Panel>
          <Tabs.Panel value="biomechanics">
            <BiomechanicsTab athleteUuid={athleteUuid} summary={summary} />
          </Tabs.Panel>
          <Tabs.Panel value="hitting">
            <HittingTab athleteUuid={athleteUuid} summary={summary} />
          </Tabs.Panel>
          <Tabs.Panel value="assessments">
            <AthleticScreenTab athleteUuid={athleteUuid} summary={summary} />
          </Tabs.Panel>
          <Tabs.Panel value="mobility">
            <MobilityTab athleteUuid={athleteUuid} />
          </Tabs.Panel>
          <Tabs.Panel value="prosup">
            <ProSupTab athleteUuid={athleteUuid} />
          </Tabs.Panel>
          <Tabs.Panel value="curveball">
            <CurveballTab athleteUuid={athleteUuid} />
          </Tabs.Panel>
          <Tabs.Panel value="readiness">
            <ReadinessTab athleteUuid={athleteUuid} />
          </Tabs.Panel>
          <Tabs.Panel value="proteus">
            <ProteusTab athleteUuid={athleteUuid} summary={summary} />
          </Tabs.Panel>
          <Tabs.Panel value="program">
            <ProgramTab athleteUuid={athleteUuid} />
          </Tabs.Panel>
          <Tabs.Panel value="throwing">
            <ThrowingTab athleteUuid={athleteUuid} />
          </Tabs.Panel>
          <Tabs.Panel value="programManagement">
            <ProgramManagementTab summary={summary} />
          </Tabs.Panel>
          </>}
          {allVs.length > 0 && (
            <Tabs.Panel value="compare">
              <CompareBody ids={[athleteUuid, ...allVs]} />
            </Tabs.Panel>
          )}
        </div>
      </Tabs>
    </Stack>
  );
}

export function AthleteView({ athleteUuid }: { athleteUuid: string }) {
  return (
    <Suspense fallback={<Loader />}>
      <AthleteViewInner key={athleteUuid} athleteUuid={athleteUuid} />
    </Suspense>
  );
}
