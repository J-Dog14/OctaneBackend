"use client";

import { Select } from "@mantine/core";
import dynamic from "next/dynamic";
import type { RadarDataSeries } from "../MetricRadarChart";
import type { DomainWithMetrics } from "../types";
import { SERIES_COLORS } from "../constants";
import { formatMetricValueParts, getPercentileStyle } from "../domainHelpers";

const MetricRadarChart = dynamic(
  () => import("../MetricRadarChart").then((m) => ({ default: m.MetricRadarChart })),
  { ssr: false }
);

interface Props {
  domain: DomainWithMetrics;
  domainMode: "none" | "date" | "athlete";
  compareDates: string[];
  compDomains: Array<{ label: string; domain: DomainWithMetrics }>;
  availForDomain: string[];
  primaryDate: string | null | undefined;
  remainingDates: string[];
  compLoadingKeys: string[];
  loadingDates: boolean;
  compareModeButtons: React.ReactNode;
  addCompareDate: (domainId: string, date: string) => void;
  removeCompareDate: (domainId: string, date: string) => void;
}

function proteusMetricLabel(name: string): string {
  const MAP: Record<string, string> = {
    Power_high: "Peak Power",
    Velocity_high: "Peak Velocity",
    Acceleration_high: "Peak Acceleration",
    Power_mean: "Average Power",
    Velocity_mean: "Average Velocity",
    Acceleration_mean: "Average Acceleration",
  };
  return MAP[name] ?? name.replace(/_high$/i, " (Peak)").replace(/_mean$/i, " (Avg)");
}

function buildProteusSeries(
  metrics: DomainWithMetrics["metrics"],
  seriesName: string,
  color: string
): RadarDataSeries {
  return {
    name: seriesName,
    data: metrics
      .filter((m) => m.percentile != null && Number.isFinite(m.percentile))
      .map((m) => {
        const subject = proteusMetricLabel(m.name);
        return {
          subject,
          value: m.percentile!,
          fullMark: 100,
          displayValue: `${subject}: ${Math.round(m.percentile!)}th %ile`,
        };
      }),
    color,
  };
}

export function ProteusDomain({
  domain,
  domainMode,
  compareDates,
  compDomains,
  availForDomain,
  primaryDate,
  remainingDates,
  compLoadingKeys,
  loadingDates,
  compareModeButtons,
  addCompareDate,
  removeCompareDate,
}: Props) {
  const movements = Array.from(new Set(domain.metrics.map((m) => m.category)));

  return (
    <>
      {compareModeButtons}
      {domainMode === "date" && availForDomain.length > 1 && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Sessions:</span>
            <span style={{ fontSize: "13px", padding: "3px 10px", borderRadius: 6, border: "1px solid var(--accent)", background: "var(--accent-muted)", color: "var(--accent)" }}>
              {primaryDate ?? "Latest"} (primary)
            </span>
            {compareDates.map((date) => {
              const key = `${domain.domainId}|${date}`;
              const isLoading = compLoadingKeys.includes(key);
              return (
                <span key={date} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "13px", padding: "3px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-tertiary)" }}>
                  {isLoading ? `${date} (loading…)` : date}
                  <button type="button" className="btn-ghost" style={{ padding: "0 3px", fontSize: "12px" }} onClick={() => removeCompareDate(domain.domainId, date)} aria-label={`Remove ${date}`}>×</button>
                </span>
              );
            })}
            {compareDates.length < 3 && remainingDates.length > 0 && (
              <Select
                value={null}
                placeholder="+ Add date…"
                data={remainingDates.map((d) => ({ value: d, label: d }))}
                onChange={(val) => { if (val) addCompareDate(domain.domainId, val); }}
                w={150}
                size="xs"
              />
            )}
          </div>
          {loadingDates && availForDomain.length === 0 && (
            <p className="text-muted" style={{ margin: "0.5rem 0 0", fontSize: "0.8rem" }}>Loading available dates…</p>
          )}
        </div>
      )}
      {movements.map((movement) => {
        const movementMetrics = domain.metrics.filter((m) => m.category === movement);

        const proteusSeries: RadarDataSeries[] = [
          buildProteusSeries(movementMetrics, domain.sessionDate ?? "Latest", SERIES_COLORS[0]!),
          ...compDomains.map(({ label, domain: cd }, i) =>
            buildProteusSeries(
              cd.metrics.filter((m) => m.category === movement),
              label,
              SERIES_COLORS[i + 1]!,
            )
          ),
        ];

        const proteusCompRows = compDomains.map(({ label, domain: cd }) => ({
          label,
          metrics: cd.metrics.filter((m) => m.category === movement),
        }));

        return (
          <div key={movement} style={{ marginBottom: "2rem" }}>
            <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>
              {movement}{domain.sessionDate ? ` · ${domain.sessionDate}` : ""}
            </h3>
            <div style={{ marginBottom: "1rem" }}>
              <MetricRadarChart
                title={`${movement} – percentiles`}
                dataSeries={proteusSeries}
              />
            </div>
            <div className="card">
              <div className="table-scroll-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Value</th>
                      <th>Percentile</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementMetrics.map((m, i) => {
                      const { valuePart, unitPart } = formatMetricValueParts(m);
                      return (
                        <tr key={`${domain.domainId}-${movement}-${i}-${m.name}`}>
                          <td>{proteusMetricLabel(m.name)}</td>
                          <td>
                            {valuePart === "—" ? "—" : (<><strong>{valuePart}</strong>{unitPart}</>)}
                            {proteusCompRows.map(({ label, metrics: cms }) => {
                              const cm = cms.find((c) => c.name === m.name);
                              if (!cm) return null;
                              const { valuePart: cvp, unitPart: cup } = formatMetricValueParts(cm);
                              return (
                                <div key={label} style={{ marginTop: "0.4rem", borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: "0.3rem" }}>
                                  <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.38)", marginBottom: "0.1rem" }}>{label}</div>
                                  <span style={{ fontSize: "0.88rem", color: "rgba(255,255,255,0.5)" }}>
                                    {cvp !== "—" ? `${cvp}${cup}` : "—"}
                                  </span>
                                </div>
                              );
                            })}
                          </td>
                          <td>
                            {m.percentile != null ? (
                              <span style={getPercentileStyle(m.percentile)}>
                                {Math.round(m.percentile)}th %ile
                              </span>
                            ) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>{/* /table-scroll-wrapper */}
            </div>
          </div>
        );
      })}
    </>
  );
}
