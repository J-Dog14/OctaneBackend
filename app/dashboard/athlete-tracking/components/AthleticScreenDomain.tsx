"use client";

import { Fragment } from "react";
import { Select, Tooltip, ActionIcon } from "@mantine/core";
import dynamic from "next/dynamic";
import type { RadarDataSeries } from "../MetricRadarChart";
import type { DomainWithMetrics, MetricWithPercentile } from "../types";
import {
  SERIES_COLORS,
  ATHLETIC_SCREEN_MOVEMENT_ORDER,
  ATHLETIC_SCREEN_VARIABLE_ORDER,
  ATHLETIC_SCREEN_VARIABLE_DESCRIPTIONS,
  ATHLETIC_SCREEN_VARIABLE_DETAIL,
  ATHLETIC_SCREEN_TABLE_CATEGORY_ORDER,
  ATHLETIC_SCREEN_CATEGORY_LABELS,
} from "../constants";
import { metricsToRadarData, formatMetricValueParts, getPercentileStyle } from "../domainHelpers";

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
  athleticScreenSubIndex: number;
  setAthleticScreenSubIndex: React.Dispatch<React.SetStateAction<number>>;
  expandedAthleticInfo: string | null;
  setExpandedAthleticInfo: React.Dispatch<React.SetStateAction<string | null>>;
  addCompareDate: (domainId: string, date: string) => void;
  removeCompareDate: (domainId: string, date: string) => void;
}

export function AthleticScreenDomain({
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
  athleticScreenSubIndex,
  setAthleticScreenSubIndex,
  expandedAthleticInfo,
  setExpandedAthleticInfo,
  addCompareDate,
  removeCompareDate,
}: Props) {
  const movements = ATHLETIC_SCREEN_MOVEMENT_ORDER.filter((mov) =>
    domain.metrics.some(
      (m) => m.category === mov || (mov === "SLV" && m.category.startsWith("SLV_"))
    )
  );
  const currentMovement = movements[athleticScreenSubIndex] ?? movements[0];
  const currentMovementIndex = Math.max(0, movements.indexOf(currentMovement));
  const isSlv = currentMovement === "SLV";
  const movementMetrics = isSlv
    ? domain.metrics.filter((m) => m.category.startsWith("SLV_"))
    : domain.metrics.filter((m) => m.category === currentMovement);
  const slvLeft = movementMetrics.filter((m) => m.category === "SLV_Left");
  const slvRight = movementMetrics.filter((m) => m.category === "SLV_Right");
  const metricByCategoryAndName = new Map<string, MetricWithPercentile>();
  for (const metric of domain.metrics) {
    metricByCategoryAndName.set(`${metric.category}|${metric.name}`, metric);
  }

  const athleticRadarSeries: RadarDataSeries[] = [
    {
      name: domain.sessionDate ?? "Latest",
      data: metricsToRadarData(movementMetrics, domain.domainId),
      color: SERIES_COLORS[0]!,
    },
    ...compDomains.map(({ label, domain: cd }, i) => {
      const cdMovementMetrics = isSlv
        ? cd.metrics.filter((m) => m.category.startsWith("SLV_"))
        : cd.metrics.filter((m) => m.category === currentMovement);
      return {
        name: label,
        data: metricsToRadarData(cdMovementMetrics, domain.domainId),
        color: SERIES_COLORS[i + 1]!,
      };
    }),
  ];

  const compMetricMaps = compDomains.map(({ label, domain: cd }) => {
    const map = new Map<string, MetricWithPercentile>();
    for (const m of cd.metrics) map.set(`${m.category}|${m.name}`, m);
    return { label, map };
  });

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
      <div style={{ textAlign: "center", marginBottom: "0.4rem" }}>
        <div style={{ fontSize: "0.98rem", fontWeight: 600 }}>{currentMovement}</div>
        <div className="text-muted" style={{ fontSize: "0.78rem" }}>
          {movements.length > 0 ? `${currentMovementIndex + 1}/${movements.length}` : "0/0"}
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr) auto",
          alignItems: "center",
          gap: "0.6rem",
          marginBottom: "1rem",
        }}
      >
        <button
          type="button"
          className="btn-ghost"
          style={{ padding: "10px 12px", minWidth: 44, fontSize: "1.05rem", fontWeight: 700 }}
          onClick={() =>
            setAthleticScreenSubIndex((prev) =>
              movements.length === 0 ? 0 : (prev - 1 + movements.length) % movements.length
            )
          }
          disabled={movements.length <= 1}
          aria-label="Previous movement"
        >
          ←
        </button>
        {isSlv ? (
          <MetricRadarChart
            title={`SLV${domain.sessionDate ? ` (${domain.sessionDate})` : ""} – percentiles`}
            dataSeries={[
              { name: "SLV Left", data: metricsToRadarData(slvLeft, domain.domainId), color: SERIES_COLORS[0]! },
              { name: "SLV Right", data: metricsToRadarData(slvRight, domain.domainId), color: "#ef4444" },
            ]}
          />
        ) : (
          <MetricRadarChart
            title={`${currentMovement}${domain.sessionDate ? ` (${domain.sessionDate})` : ""} – percentiles`}
            data={athleticRadarSeries.length === 1 ? athleticRadarSeries[0]!.data : undefined}
            dataSeries={athleticRadarSeries.length > 1 ? athleticRadarSeries : undefined}
          />
        )}
        <button
          type="button"
          className="btn-ghost"
          style={{ padding: "10px 12px", minWidth: 44, fontSize: "1.05rem", fontWeight: 700 }}
          onClick={() =>
            setAthleticScreenSubIndex((prev) =>
              movements.length === 0 ? 0 : (prev + 1) % movements.length
            )
          }
          disabled={movements.length <= 1}
          aria-label="Next movement"
        >
          →
        </button>
      </div>
      <div className="card">
        <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>
          Metrics{domain.sessionDate ? ` · ${domain.sessionDate}` : ""}
        </h3>
        <table style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>Variable</th>
              {ATHLETIC_SCREEN_TABLE_CATEGORY_ORDER.map((cat) => (
                <th key={cat}>{ATHLETIC_SCREEN_CATEGORY_LABELS[cat]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ATHLETIC_SCREEN_VARIABLE_ORDER.map((variableName, variableIdx) => {
              const hasAny = ATHLETIC_SCREEN_TABLE_CATEGORY_ORDER.some((category) =>
                metricByCategoryAndName.has(`${category}|${variableName}`)
              );
              if (!hasAny) return null;
              return (
                <Fragment key={`athletic-var-${variableName}`}>
                  {variableIdx > 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: "0.45rem 0 0.35rem", borderBottom: "none" }}>
                        <div style={{ borderTop: "1px solid var(--border)" }} />
                      </td>
                    </tr>
                  ) : null}
                  <tr>
                    <td style={{ borderBottom: "none", padding: "0.2rem 0.35rem 0.55rem 0", maxWidth: 220 }}>
                      <div style={{ fontWeight: 600, marginBottom: "0.2rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        {variableName}
                        {ATHLETIC_SCREEN_VARIABLE_DETAIL[variableName] && (
                          <Tooltip label={`More info about ${variableName}`} withArrow position="top">
                            <ActionIcon
                              variant={expandedAthleticInfo === variableName ? "light" : "subtle"}
                              color={expandedAthleticInfo === variableName ? "octaneBlue" : "gray"}
                              radius="xl"
                              size={16}
                              onClick={() => setExpandedAthleticInfo((prev) => prev === variableName ? null : variableName)}
                              aria-label={`More info about ${variableName}`}
                              style={{ flexShrink: 0, fontSize: "10px" }}
                            >
                              i
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </div>
                      <div className="text-muted" style={{ fontSize: "0.8rem" }}>
                        {ATHLETIC_SCREEN_VARIABLE_DESCRIPTIONS[variableName]}
                      </div>
                      {expandedAthleticInfo === variableName && ATHLETIC_SCREEN_VARIABLE_DETAIL[variableName] && (() => {
                        const detail = ATHLETIC_SCREEN_VARIABLE_DETAIL[variableName]!;
                        return (
                          <div style={{
                            marginTop: "0.6rem",
                            padding: "0.6rem 0.75rem",
                            borderRadius: 6,
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid var(--border)",
                            fontSize: "0.76rem",
                            lineHeight: 1.5,
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.5rem",
                          }}>
                            <div>
                              <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>Formula</div>
                              <div style={{ color: "rgba(255,255,255,0.7)" }}>{detail.formula}</div>
                            </div>
                            <div>
                              <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>What the number means</div>
                              <div style={{ color: "rgba(255,255,255,0.7)" }}>{detail.what}</div>
                            </div>
                            <div>
                              <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>Benchmarks</div>
                              <div style={{ color: "rgba(255,255,255,0.7)" }}>{detail.benchmarks}</div>
                            </div>
                            <div>
                              <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>Characterizes</div>
                              <div style={{ color: "rgba(255,255,255,0.7)" }}>{detail.characterizes}</div>
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                    {ATHLETIC_SCREEN_TABLE_CATEGORY_ORDER.map((category) => {
                      const metric = metricByCategoryAndName.get(`${category}|${variableName}`) ?? null;
                      return (
                        <td key={`athletic-cell-${variableName}-${category}`} style={{ verticalAlign: "top" }}>
                          {metric ? (
                            <>
                              <div>
                                {(() => {
                                  const { valuePart, unitPart } = formatMetricValueParts(metric);
                                  return valuePart === "—" ? "" : (<><strong>{valuePart}</strong>{unitPart}</>);
                                })()}
                              </div>
                              <div
                                className={metric.percentile == null ? "text-muted" : undefined}
                                style={{
                                  marginTop: "0.2rem",
                                  fontSize: "0.78rem",
                                  ...(metric.percentile != null ? (getPercentileStyle(metric.percentile) ?? {}) : {}),
                                }}
                              >
                                {metric.percentile != null ? `${Math.round(metric.percentile)}th %ile` : ""}
                              </div>
                              {compMetricMaps.map(({ label, map }) => {
                                const cm = map.get(`${category}|${variableName}`);
                                if (!cm) return null;
                                const { valuePart, unitPart } = formatMetricValueParts(cm);
                                return (
                                  <div key={label} style={{ marginTop: "0.4rem", borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: "0.3rem" }}>
                                    <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.38)", marginBottom: "0.1rem" }}>{label}</div>
                                    <span style={{ fontSize: "0.88rem", color: "rgba(255,255,255,0.5)" }}>
                                      {valuePart !== "—" ? `${valuePart}${unitPart}` : "—"}
                                    </span>
                                  </div>
                                );
                              })}
                            </>
                          ) : (
                            ""
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
