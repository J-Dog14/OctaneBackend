"use client";

import { useState } from "react";
import useSWR from "swr";
import { ScrollArea, SegmentedControl, Stack, Table, Text } from "@mantine/core";
import type { CoachAthleteSummary, CurveballSession, ProSupSession } from "@/lib/coach/summary";
import { DomainSwitcher } from "../_components/DomainWorkspace";
import { AthleticScreenReport } from "../_reports/AthleticScreenReport";
import { ProSupReport } from "../_reports/ProSupReport";
import { MetricLineChart } from "@/app/dashboard/athlete-tracking/MetricLineChart";
import { assessmentsKey, fmt, fmtDate, swrOpts } from "../_components/fetcher";
export { MobilityTab } from "./MobilityTab";
import { LoadState, SectionHead, pickDomains, useTracking } from "./shared";

function ProSupCard({ rows }: { rows: ProSupSession[] }) {
  const chrono = [...rows].reverse();
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <SectionHead title="Pro-sup history" sub={`${rows.length} test${rows.length === 1 ? "" : "s"}`} />
      <MetricLineChart title="Total score" data={chrono.map((r) => ({ date: r.date, value: r.totalScore }))} />
      <ScrollArea mt="sm">
        <Table fz="sm" verticalSpacing={3} miw={520}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th>
              <Table.Th ta="right">Score</Table.Th>
              <Table.Th ta="right">Total ROM</Table.Th>
              <Table.Th ta="right">Flips</Table.Th>
              <Table.Th ta="right">Avg velo</Table.Th>
              <Table.Th ta="right">Fatigue</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.date}>
                <Table.Td>{fmtDate(r.date)}</Table.Td>
                <Table.Td ta="right" fw={600}>{fmt(r.totalScore)}</Table.Td>
                <Table.Td ta="right">{fmt(r.totRom)}</Table.Td>
                <Table.Td ta="right">{fmt(r.flips, 0)}</Table.Td>
                <Table.Td ta="right">{fmt(r.avgVelo)}</Table.Td>
                <Table.Td ta="right">{fmt(r.fatigueScore)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </div>
  );
}

function CurveballCard({ rows }: { rows: CurveballSession[] }) {
  const chrono = [...rows].reverse();
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <SectionHead title="Curveball test" sub="pitch stability score" />
      <MetricLineChart title="Average stability" data={chrono.map((r) => ({ date: r.date, value: r.avgStability }))} />
      <ScrollArea mt="sm">
        <Table fz="sm" verticalSpacing={3} miw={420}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th>
              <Table.Th ta="right">Pitches</Table.Th>
              <Table.Th ta="right">Avg</Table.Th>
              <Table.Th ta="right">Best</Table.Th>
              <Table.Th>Types</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.date}>
                <Table.Td>{fmtDate(r.date)}</Table.Td>
                <Table.Td ta="right">{r.pitches}</Table.Td>
                <Table.Td ta="right" fw={600}>{fmt(r.avgStability)}</Table.Td>
                <Table.Td ta="right">{fmt(r.bestStability)}</Table.Td>
                <Table.Td>{r.pitchTypes.join(", ") || "—"}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </div>
  );
}

function useHistory(athleteUuid: string) {
  return useSWR<{ proSup: ProSupSession[]; curveball: CurveballSession[] }>(assessmentsKey(athleteUuid), swrOpts);
}

/** Athletic Screen tab: the screen report (like the PDF) or the metrics explorer. */
export function AthleticScreenTab({ athleteUuid, summary }: { athleteUuid: string; summary: CoachAthleteSummary }) {
  const [view, setView] = useState<"report" | "explorer">("report");
  const tracking = useTracking(athleteUuid);
  return (
    <Stack gap="md">
      <SegmentedControl
        w="fit-content"
        value={view}
        onChange={(v) => setView(v as "report" | "explorer")}
        data={[
          { value: "report", label: "Report" },
          { value: "explorer", label: "Metrics explorer" },
        ]}
      />
      {view === "report" ? (
        <AthleticScreenReport athleteUuid={athleteUuid} />
      ) : !tracking.data ? (
        <LoadState isLoading={tracking.isLoading} error={tracking.error} />
      ) : (
        <DomainSwitcher athleteUuid={athleteUuid} domains={pickDomains(tracking.data, ["athleticScreen"])} datesByDomain={summary.trackingDates} emptyText="No athletic screens yet." />
      )}
    </Stack>
  );
}

/** Pro/Sup tab: the report (like the pro-sup PDF) with the test history underneath. */
export function ProSupTab({ athleteUuid }: { athleteUuid: string }) {
  const history = useHistory(athleteUuid);
  return (
    <Stack gap="lg">
      <ProSupReport athleteUuid={athleteUuid} />
      {history.data && history.data.proSup.length > 1 && <ProSupCard rows={history.data.proSup} />}
    </Stack>
  );
}

/** Curveball tab (only shown when the athlete has curveball tests). */
export function CurveballTab({ athleteUuid }: { athleteUuid: string }) {
  const history = useHistory(athleteUuid);
  if (!history.data) return <LoadState isLoading={history.isLoading} error={history.error} />;
  return history.data.curveball.length ? <CurveballCard rows={history.data.curveball} /> : <Text c="dimmed">No curveball tests yet.</Text>;
}
