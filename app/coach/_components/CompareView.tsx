"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import useSWR from "swr";
import { Alert, Group, Loader, ScrollArea, Select, SimpleGrid, Stack, Table, Text } from "@mantine/core";
import type { DomainWithMetrics, MetricWithPercentile } from "@/app/dashboard/athlete-tracking/types";
import type { CoachPitching } from "@/lib/coach/pitching";
import { SERIES_COLORS } from "@/app/dashboard/athlete-tracking/constants";
import { formatMetricValueParts, getPercentileStyle, getRadarMetricsForDomain, metricsToRadarData } from "@/app/dashboard/athlete-tracking/domainHelpers";
import { formatMetricDisplayName } from "@/lib/athlete-tracking/displayNames";
import { PITCH_LABELS, type PitchCode } from "@/lib/pitch-intel/pitch-types";
import { useCoachFetcher, fmt, fmtDate } from "./fetcher";
import { COMPARISON_LABELS, type ComparisonScope } from "@/lib/coach/comparison";
import { loadComparisonBundles, type AthleteBundle } from "./compareData";
import { ArsenalBadge, MovementPlot } from "./pitching";

const MetricRadarChart = dynamic(
  () => import("@/app/dashboard/athlete-tracking/MetricRadarChart").then((m) => ({ default: m.MetricRadarChart })),
  { ssr: false },
);

/** Primary fastball row (FF, else SI) from the newest graded arsenal. */
function primaryFastball(p: CoachPitching | null) {
  const rows = p?.latest?.byType ?? [];
  return rows.find((r) => r.pitchType === "FF") ?? rows.find((r) => r.pitchType === "SI") ?? null;
}

function SnapshotTable({ bundles, scope }: { bundles: AthleteBundle[]; scope: ComparisonScope }) {
  type Row = { label: string; cell: (b: AthleteBundle) => React.ReactNode };
  const rows: Row[] = [
    { label: "Age / group", cell: (b) => [b.summary?.athlete.age != null ? `${b.summary.athlete.age}` : null, b.summary?.athlete.ageGroup].filter(Boolean).join(" · ") || "—" },
    { label: "Throws · level", cell: (b) => [b.summary?.athlete.throws ? `${b.summary.athlete.throws}HP` : null, b.summary?.athlete.level].filter(Boolean).join(" · ") || "—" },
    { label: "Height / weight", cell: (b) => [b.summary?.athlete.height ?? null, b.summary?.athlete.weight ?? null].filter(Boolean).join(" · ") || "—" },
    { label: "Arsenal", cell: (b) => (b.pitching?.latest?.arsenal ? <ArsenalBadge arsenal={b.pitching.latest.arsenal} size="sm" /> : "—") },
    {
      label: "Fastball (latest arsenal)",
      cell: (b) => {
        const fb = primaryFastball(b.pitching);
        return fb ? `${PITCH_LABELS[fb.pitchType]} ${fmt(fb.velo)} mph · ${fmt(fb.ivb)} IVB · ${fmt(fb.hbArm)} HB` : "—";
      },
    },
    { label: "Arsenal source", cell: (b) => b.pitching?.latest?.label ?? "—" },
    {
      label: "Readiness",
      cell: (b) => {
        const s = b.readiness?.latest_score;
        return s?.composite_score != null ? `${Math.round(s.composite_score)} · ${s.band ?? "—"} · ${fmtDate(s.date)}` : "—";
      },
    },
    { label: "Last 3D pitching", cell: (b) => fmtDate(b.tracking?.domains.find((d) => d.domainId === "pitching")?.sessionDate) },
  ];
  return (
    <ScrollArea>
      <Table fz="sm" verticalSpacing={6} miw={200 + bundles.length * 220}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th />
            {bundles.map((b, i) => (
              <Table.Th key={b.uuid}>
                <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 999, background: SERIES_COLORS[i], marginRight: 6 }} />
                <Link href={`/coach/athletes/${b.uuid}`} style={{ color: "var(--text-primary)" }}>
                  {b.summary?.athlete.name ?? b.tracking?.athlete.name ?? "Unknown"}
                </Link>
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.filter((r, i) => i < 3 || scope === "all" || scope === "overview"
            || (scope === "pitching" && ["Arsenal", "Fastball (latest arsenal)", "Arsenal source"].includes(r.label))
            || (scope === "readiness" && r.label === "Readiness")
            || (scope === "biomechanics" && r.label === "Last 3D pitching")).map((r) => (
            <Table.Tr key={r.label}>
              <Table.Td c="dimmed">{r.label}</Table.Td>
              {bundles.map((b) => (
                <Table.Td key={b.uuid}>{r.cell(b)}</Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

function ArsenalCompare({ bundles }: { bundles: AthleteBundle[] }) {
  const withData = bundles.filter((b) => b.pitching?.latest);
  if (withData.length === 0) return <Text size="sm" c="dimmed">No graded arsenals among these athletes.</Text>;
  const codes: PitchCode[] = ["FF", "SI", "FC", "SL", "ST", "CU", "KC", "CH", "FS"];
  const present = codes.filter((c) => withData.some((b) => b.pitching!.latest!.byType.some((r) => r.pitchType === c)));
  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
      <MovementPlot sets={withData.map((b) => ({ name: b.summary?.athlete.name ?? b.uuid, rows: b.pitching!.latest!.byType, throws: b.pitching!.athlete.throws ?? b.summary?.athlete.throws ?? null }))} height={340} />
      <ScrollArea>
        <Table fz="sm" verticalSpacing={4} miw={160 + withData.length * 150}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Pitch</Table.Th>
              {withData.map((b) => (
                <Table.Th key={b.uuid} ta="right">{b.summary?.athlete.name ?? "—"}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {present.map((c) => (
              <Table.Tr key={c}>
                <Table.Td>{PITCH_LABELS[c]}</Table.Td>
                {withData.map((b) => {
                  const r = b.pitching!.latest!.byType.find((x) => x.pitchType === c);
                  return (
                    <Table.Td key={b.uuid} ta="right">
                      {r ? (
                        <>
                          <div style={{ fontWeight: 600 }}>{fmt(r.velo)} mph{r.grade ? ` · ${r.grade.grade}` : ""}</div>
                          <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                            {fmt(r.ivb)} IVB · {fmt(r.hbArm)} HB · {r.usagePct == null ? "—" : `${fmt(r.usagePct)}%`}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </SimpleGrid>
  );
}

function DomainCompare({ bundles }: { bundles: AthleteBundle[] }) {
  const domainOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const b of bundles) for (const d of b.tracking?.domains ?? []) if (!seen.has(d.domainId)) seen.set(d.domainId, d.label);
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [bundles]);
  const [domainId, setDomainId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const active = domainOptions.find((o) => o.value === domainId)?.value ?? domainOptions[0]?.value ?? null;

  const perAthlete = bundles.map((b) => ({ b, domain: b.tracking?.domains.find((d) => d.domainId === active) as DomainWithMetrics | undefined }))
    .filter((entry) => entry.domain != null);
  // Athletic screen and Proteus mix movements; compare one at a time.
  const categories = useMemo(() => {
    if (active !== "athleticScreen" && active !== "proteus") return [];
    const set = new Set<string>();
    for (const { domain } of perAthlete) for (const m of domain?.metrics ?? []) set.add(m.category);
    return [...set];
  }, [active, perAthlete]);
  const activeCategory = categories.includes(category ?? "") ? category : categories[0] ?? null;
  const filterMetrics = (ms: MetricWithPercentile[]) => (activeCategory ? ms.filter((m) => m.category === activeCategory) : ms);

  if (!active) return <Text size="sm" c="dimmed">None of these athletes have assessment data yet.</Text>;

  const series = perAthlete
    .map(({ b, domain }) =>
      domain
        ? {
            name: b.summary?.athlete.name ?? b.uuid,
            data: metricsToRadarData(filterMetrics(getRadarMetricsForDomain(domain.metrics, active)), active),
            color: SERIES_COLORS[bundles.indexOf(b)]!,
          }
        : null,
    )
    .filter((s): s is NonNullable<typeof s> => s != null && s.data.length > 0);

  // Table: union of metrics in display order of the first athlete that has them.
  const keys: Array<{ key: string; m: MetricWithPercentile }> = [];
  const seenKeys = new Set<string>();
  for (const { domain } of perAthlete) {
    for (const m of filterMetrics(domain?.metrics ?? [])) {
      const k = `${m.category}|${m.name}`;
      if (m.mobilityMetricKind === "COMPONENT" || seenKeys.has(k)) continue;
      seenKeys.add(k);
      keys.push({ key: k, m });
    }
  }

  return (
    <Stack gap="md">
      <Group gap="sm">
        <Select data={domainOptions} value={active} onChange={(v) => { setDomainId(v); setCategory(null); }} allowDeselect={false} w={220} />
        {categories.length > 1 && (
          <Select data={categories.map((c) => ({ value: c, label: c.replace("_", " ") }))} value={activeCategory} onChange={setCategory} allowDeselect={false} w={200} />
        )}
        <Text size="sm" c="dimmed">Latest session for each athlete · percentiles vs the database</Text>
      </Group>
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <MetricRadarChart dataSeries={series} title="Percentiles" />
        <ScrollArea h={460}>
          <Table fz="sm" verticalSpacing={4} stickyHeader miw={200 + perAthlete.length * 120}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Metric</Table.Th>
                {perAthlete.map(({ b, domain }) => (
                  <Table.Th key={b.uuid} ta="right">
                    {b.summary?.athlete.name ?? "—"}
                    <div style={{ fontWeight: 400, fontSize: 11, color: "var(--text-muted)" }}>{domain?.sessionDate ? fmtDate(domain.sessionDate) : "no data"}</div>
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {keys.map(({ key, m }) => (
                <Table.Tr key={key}>
                  <Table.Td>{formatMetricDisplayName(m.name, m.category, active)}</Table.Td>
                  {perAthlete.map(({ b, domain }) => {
                    const x = domain?.metrics.find((y) => `${y.category}|${y.name}` === key);
                    if (!x) return <Table.Td key={b.uuid} ta="right">—</Table.Td>;
                    const { valuePart, unitPart } = formatMetricValueParts(x);
                    return (
                      <Table.Td key={b.uuid} ta="right">
                        <div>{valuePart}{valuePart !== "—" ? unitPart : ""}</div>
                        {x.percentile != null && (
                          <div style={{ fontSize: 11, ...getPercentileStyle(x.percentile) }}>{Math.round(x.percentile)}th %ile</div>
                        )}
                      </Table.Td>
                    );
                  })}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </SimpleGrid>
    </Stack>
  );
}

/**
 * Side-by-side comparison for the athlete page's Compare tab. `ids[0]` is the
 * athlete whose page this is; the rest were added with "Compare".
 */
function DetailCompare({ bundles, scope }: { bundles: AthleteBundle[]; scope: "readiness" | "prosup" | "curveball" }) {
  const rows: Array<{ label: string; value: (b: AthleteBundle) => string }> = scope === "readiness" ? [
    { label: "Session", value: (b) => fmtDate(b.readiness?.latest_score?.date) },
    { label: "Composite score", value: (b) => fmt(b.readiness?.latest_score?.composite_score, 0) },
    { label: "Band", value: (b) => b.readiness?.latest_score?.band ?? "?" },
    ...(["cmj_z", "ppu_z", "iso_z", "power_curve_z", "grip_z"] as const).map((key) => ({
      label: { cmj_z: "CMJ z-score", ppu_z: "PPU z-score", iso_z: "Isometric z-score", power_curve_z: "Power curve z-score", grip_z: "Grip z-score" }[key],
      value: (b: AthleteBundle) => fmt(b.readiness?.latest_score?.[key], 2),
    })),
  ] : scope === "prosup" ? [
    { label: "Session", value: (b) => fmtDate(b.assessments?.proSup[0]?.date) },
    ...(["totalScore", "totRom", "forearmRom", "flips", "avgVelo", "fatigueScore", "consistencyPenalty"] as const).map((key) => ({
      label: { totalScore: "Total score", totRom: "Total ROM", forearmRom: "Forearm ROM", flips: "Flips", avgVelo: "Average velocity", fatigueScore: "Fatigue score", consistencyPenalty: "Consistency penalty" }[key],
      value: (b: AthleteBundle) => fmt(b.assessments?.proSup[0]?.[key]),
    })),
  ] : [
    { label: "Session", value: (b) => fmtDate(b.assessments?.curveball[0]?.date) },
    { label: "Pitches", value: (b) => fmt(b.assessments?.curveball[0]?.pitches, 0) },
    { label: "Average stability", value: (b) => fmt(b.assessments?.curveball[0]?.avgStability) },
    { label: "Best stability", value: (b) => fmt(b.assessments?.curveball[0]?.bestStability) },
    { label: "Pitch types", value: (b) => b.assessments?.curveball[0]?.pitchTypes.join(", ") || "?" },
  ];
  return <ScrollArea><Table fz="sm" miw={200 + bundles.length * 170}>
    <Table.Thead><Table.Tr><Table.Th>Latest session</Table.Th>{bundles.map((b) => <Table.Th key={b.uuid} ta="right">{b.summary.athlete.name}</Table.Th>)}</Table.Tr></Table.Thead>
    <Table.Tbody>{rows.map((r) => <Table.Tr key={r.label}><Table.Td>{r.label}</Table.Td>{bundles.map((b) => <Table.Td key={b.uuid} ta="right">{r.value(b)}</Table.Td>)}</Table.Tr>)}</Table.Tbody>
  </Table></ScrollArea>;
}

export function CompareBody({ ids, scope = "all" }: { ids: string[]; scope?: ComparisonScope }) {
  const fetcher = useCoachFetcher();
  const { data, isLoading, error } = useSWR(ids.length ? ["coach-compare", scope, ids] : null,
    ([, selectedScope, list]) => loadComparisonBundles(fetcher, list as string[], selectedScope as ComparisonScope),
    { revalidateOnFocus: false });
  const bundles = (data ?? []).filter((b) => ids.includes(b.uuid) && b.available);
  if (error) return <Alert color="red">{String(error)}</Alert>;
  if (isLoading) return <Loader size="sm" />;
  if (bundles.length < 2) return <Text c="dimmed">Add another athlete with {COMPARISON_LABELS[scope].toLowerCase()} data to compare.</Text>;

  return <Stack gap="lg">
    <div className="card" style={{ marginBottom: 0 }}>
      <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>{COMPARISON_LABELS[scope]} comparison</h2>
      <SnapshotTable bundles={bundles} scope={scope} />
    </div>
    {(scope === "all" || scope === "pitching") && <div className="card" style={{ marginBottom: 0 }}>
      <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Arsenal</h2><ArsenalCompare bundles={bundles} />
    </div>}
    {(scope === "all" || ["biomechanics", "hitting", "assessments", "mobility", "proteus"].includes(scope)) && <div className="card" style={{ marginBottom: 0 }}>
      <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>{scope === "all" ? "Assessments" : COMPARISON_LABELS[scope]}</h2>
      <DomainCompare key={scope} bundles={bundles} />
    </div>}
    {(["readiness", "prosup", "curveball"] as const).filter((kind) => scope === kind || (scope === "all" && bundles.some((b) => b.summary.tabs[kind]))).map((kind) => <div className="card" key={kind} style={{ marginBottom: 0 }}>
      <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>{COMPARISON_LABELS[kind]}</h2><DetailCompare bundles={bundles} scope={kind} />
    </div>)}
  </Stack>;
}
