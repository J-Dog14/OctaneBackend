"use client";

import React, { Fragment } from "react";
import dynamic from "next/dynamic";
import type { RadarDataSeries } from "../MetricRadarChart";
import type { DomainWithMetrics } from "../types";
import { PITCHING_TABLE_SECTIONS, HITTING_TABLE_SECTIONS } from "../constants";
import {
  getPercentileStyle,
  formatMetricValueParts,
  getMetricByKey,
  getMetricInsight,
  isShoulderRomMetric,
  getMobilityComponentScoreValue,
  scoreOutOfThreeFromPercentile,
  formatMobilityComponentLabel,
  formatMobilityComponentValue,
  buildMobilityGroupSections,
} from "../domainHelpers";
import { buildPitchingDisplayCells, buildHittingDisplayCells } from "../displayBuilders";
import { formatMetricDisplayName } from "@/lib/athlete-tracking/displayNames";
import { PitchingDiagram, hasPitchingDiagram } from "../PitchingDiagram";

const MetricRadarChart = dynamic(
  () => import("../MetricRadarChart").then((m) => ({ default: m.MetricRadarChart })),
  { ssr: false }
);
const MetricLineChart = dynamic(
  () => import("../MetricLineChart").then((m) => ({ default: m.MetricLineChart })),
  { ssr: false }
);

function getMetricValueFromDomain(d: DomainWithMetrics | undefined, key: string): string {
  if (!d) return "—";
  const metric = getMetricByKey(d.metrics, key);
  if (!metric) return "—";
  const { valuePart, unitPart } = formatMetricValueParts(metric);
  return valuePart === "—" ? "—" : `${valuePart}${unitPart}`;
}

interface Props {
  domain: DomainWithMetrics;
  domainMode: "none" | "date" | "athlete";
  viewMode: "compare" | "timeline";
  compareDates: string[];
  compDomains: Array<{ label: string; domain: DomainWithMetrics }>;
  series: RadarDataSeries[];
  availForDomain: string[];
  primaryDate: string | null | undefined;
  remainingDates: string[];
  compLoadingKeys: string[];
  loadingDates: boolean;
  timelineKeys: string[];
  timelineDates: string[];
  compareModeButtons: React.ReactNode;
  expandedMobilityGroups: Record<string, boolean>;
  setExpandedMobilityGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  addCompareDate: (domainId: string, date: string) => void;
  removeCompareDate: (domainId: string, date: string) => void;
  setDomainViewMode: React.Dispatch<React.SetStateAction<Record<string, "compare" | "timeline">>>;
  getDomainForDate: (date: string) => DomainWithMetrics | undefined;
}

export function GenericDomain({
  domain,
  domainMode,
  viewMode,
  compareDates,
  compDomains,
  series,
  availForDomain,
  primaryDate,
  remainingDates,
  compLoadingKeys,
  loadingDates,
  timelineKeys,
  timelineDates,
  compareModeButtons,
  expandedMobilityGroups,
  setExpandedMobilityGroups,
  addCompareDate,
  removeCompareDate,
  setDomainViewMode,
  getDomainForDate,
}: Props) {
  return (
    <>
      {compareModeButtons}
      {/* Session comparison panel */}
      {domainMode === "date" && availForDomain.length > 1 && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Sessions:</span>
            <span
              style={{
                fontSize: "13px",
                padding: "3px 10px",
                borderRadius: 6,
                border: "1px solid var(--accent)",
                background: "var(--accent-muted)",
                color: "var(--accent)",
              }}
            >
              {primaryDate ?? "Latest"} (primary)
            </span>
            {compareDates.map((date) => {
              const key = `${domain.domainId}|${date}`;
              const isLoading = compLoadingKeys.includes(key);
              return (
                <span
                  key={date}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    fontSize: "13px",
                    padding: "3px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg-tertiary)",
                  }}
                >
                  {isLoading ? `${date} (loading…)` : date}
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ padding: "0 3px", fontSize: "12px" }}
                    onClick={() => removeCompareDate(domain.domainId, date)}
                    aria-label={`Remove ${date}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
            {compareDates.length < 3 && remainingDates.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) addCompareDate(domain.domainId, e.target.value);
                }}
                style={{
                  padding: "3px 8px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--bg-tertiary)",
                  color: "var(--text-secondary)",
                  fontSize: "13px",
                }}
              >
                <option value="">+ Add date…</option>
                {remainingDates.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}
            {/* View mode toggle: Radar / Timeline */}
            {timelineKeys.length > 0 && (
              <div style={{ marginLeft: "auto", display: "flex", gap: "0.35rem" }}>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{
                    fontSize: "12px",
                    padding: "3px 10px",
                    borderRadius: 6,
                    border: `1px solid ${viewMode === "compare" ? "var(--accent)" : "var(--border)"}`,
                    background: viewMode === "compare" ? "var(--accent-muted)" : "var(--bg-tertiary)",
                    color: viewMode === "compare" ? "var(--accent)" : "var(--text-secondary)",
                  }}
                  onClick={() => setDomainViewMode((prev) => ({ ...prev, [domain.domainId]: "compare" }))}
                >
                  Radar
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{
                    fontSize: "12px",
                    padding: "3px 10px",
                    borderRadius: 6,
                    border: `1px solid ${viewMode === "timeline" ? "var(--accent)" : "var(--border)"}`,
                    background: viewMode === "timeline" ? "var(--accent-muted)" : "var(--bg-tertiary)",
                    color: viewMode === "timeline" ? "var(--accent)" : "var(--text-secondary)",
                  }}
                  onClick={() => setDomainViewMode((prev) => ({ ...prev, [domain.domainId]: "timeline" }))}
                >
                  Timeline
                </button>
              </div>
            )}
          </div>
          {loadingDates && availForDomain.length === 0 && (
            <p className="text-muted" style={{ margin: "0.5rem 0 0", fontSize: "0.8rem" }}>Loading available dates…</p>
          )}
        </div>
      )}

      {/* Timeline view */}
      {viewMode === "timeline" && timelineKeys.length > 0 && timelineDates.length > 0 ? (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Timeline</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: "1.25rem",
            }}
          >
            {timelineKeys.map((key) => {
              const [cat, name] = key.split("|") as [string, string];
              const label = formatMetricDisplayName(name, cat, domain.domainId);
              const chartDates = [...timelineDates].sort((a, b) => a.localeCompare(b));
              const chartData = chartDates.map((date) => {
                const d = getDomainForDate(date);
                const raw = getMetricValueFromDomain(d, key);
                const num = raw === "—" ? null : parseFloat(raw);
                return { date, value: Number.isFinite(num) ? num : null };
              });
              const sampleMetric = getMetricByKey(domain.metrics, key);
              const unit = sampleMetric?.valueUnit && sampleMetric.valueUnit !== "NONE" && sampleMetric.valueUnit !== "UNITLESS"
                ? sampleMetric.valueUnit.toLowerCase().replace(/_/g, " ")
                : undefined;
              return (
                <MetricLineChart
                  key={key}
                  title={label}
                  data={chartData}
                  unit={unit}
                />
              );
            })}
          </div>
          {timelineDates.some((d) => d !== primaryDate && !getDomainForDate(d)) && (
            <p className="text-muted" style={{ margin: "0.75rem 0 0", fontSize: "0.8rem" }}>
              Add comparison dates above to populate the timeline.
            </p>
          )}
        </div>
      ) : (
        /* Radar / compare view */
        <div style={{ marginBottom: "1rem" }}>
          <MetricRadarChart
            title={
              domain.sessionDate
                ? `${domain.label} (${domain.sessionDate}) – percentiles`
                : `${domain.label} – percentiles`
            }
            data={series.length === 1 ? series[0]!.data : undefined}
            dataSeries={series.length > 1 ? series : undefined}
          />
        </div>
      )}

      {/* Domain-specific detail tables */}
      {domain.domainId === "pitching" ? (
        <>
          {PITCHING_TABLE_SECTIONS.map((section) => {
            const cells = buildPitchingDisplayCells(domain.metrics, section.items);
            const compCellSets = compDomains.map(({ label, domain: cd }) => ({
              label,
              cells: buildPitchingDisplayCells(cd.metrics, section.items),
            }));

            const peakOrderRanks: Record<string, number> = {};
            if (section.id === "kinematic-sequence") {
              const timingKeys = [
                { key: "KINEMATIC_SEQUENCE|PELVIS", timeKey: "KINEMATIC_SEQUENCE|PELVIS_TIME" },
                { key: "KINEMATIC_SEQUENCE|TORSO", timeKey: "KINEMATIC_SEQUENCE|TORSO_TIME" },
                { key: "KINEMATIC_SEQUENCE|ARM", timeKey: "KINEMATIC_SEQUENCE|ARM_TIME" },
                { key: "KINEMATIC_SEQUENCE|HAND", timeKey: "KINEMATIC_SEQUENCE|HAND_TIME" },
              ];
              const times = timingKeys.map(({ key, timeKey }) => {
                const m = domain.metrics.find(
                  (met) => met.category && `${met.category}|${met.name}` === timeKey
                );
                return { key, time: m?.value ?? null };
              });
              const withTime = times.filter((t) => t.time != null);
              withTime.sort((a, b) => (a.time as number) - (b.time as number));
              withTime.forEach((t, i) => { peakOrderRanks[t.key] = i + 1; });
            }

            const insights: Array<{ label: string; text: string }> = [];
            if (section.insightKeys) {
              for (const iKey of section.insightKeys) {
                const m = domain.metrics.find(
                  (met) => met.category && `${met.category}|${met.name}` === iKey
                );
                const text = getMetricInsight(iKey, m?.value ?? null);
                if (text) {
                  const cellForKey = cells.find((c) => c.key === iKey);
                  insights.push({ label: cellForKey?.label ?? iKey, text });
                }
              }
            }

            const hasDiagram = hasPitchingDiagram(section.id);

            return (
              <div key={section.id} className="card" style={{ marginBottom: "1rem" }}>
                {hasDiagram ? (
                  <div className="diagram-header">
                    <PitchingDiagram sectionId={section.id} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {section.title ? (
                        <h3 style={{ margin: "0 0 0.35rem", fontSize: "1rem" }}>{section.title}</h3>
                      ) : null}
                      <p
                        className="text-muted"
                        style={{ margin: 0, fontSize: "0.82rem", lineHeight: 1.45 }}
                      >
                        {section.description}
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {section.title ? (
                      <h3 style={{ margin: "0 0 0.35rem", fontSize: "1rem" }}>{section.title}</h3>
                    ) : null}
                    <p
                      className="text-muted"
                      style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", lineHeight: 1.45 }}
                    >
                      {section.description}
                    </p>
                  </>
                )}
                <div className="table-scroll-wrapper">
                  <table>
                    <thead>
                      <tr>
                        {cells.map((cell) => (
                          <th key={`${section.id}-${cell.key}`}>{cell.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {cells.map((cell, cellIdx) => (
                          <td key={`${section.id}-${cell.key}-value`}>
                            {cell.valuePart === "—" ? "—" : (() => {
                              const isGainOrLoss = cell.key.endsWith("|GAIN_OR_LOSS");
                              const valueStyle: React.CSSProperties | undefined =
                                isGainOrLoss
                                  ? cell.valuePart === "GAIN"
                                    ? { color: "#16a34a" }
                                    : cell.valuePart === "LOSS"
                                      ? { color: "var(--accent-secondary)" }
                                      : undefined
                                  : cell.key === "DERIVED|ARM_TIMING_FLAG"
                                    ? cell.valuePart === "ON_TIME"
                                      ? { color: "#16a34a" }
                                      : cell.valuePart === "EARLY" || cell.valuePart === "LATE"
                                        ? { color: "var(--accent-secondary)" }
                                        : undefined
                                    : cell.percentile != null
                                      ? (getPercentileStyle(cell.percentile) ?? undefined)
                                      : undefined;
                              return (
                                <>
                                  <strong style={valueStyle}>{cell.valuePart}</strong>
                                  {cell.unitPart && (
                                    <span style={valueStyle}>{cell.unitPart}</span>
                                  )}
                                </>
                              );
                            })()}
                            {!cell.key.endsWith("|GAIN_OR_LOSS") && cell.key !== "DERIVED|ARM_TIMING_FLAG" && cell.valuePart !== "N/A" && (
                              <div
                                className={cell.percentile == null ? "text-muted" : undefined}
                                style={{
                                  marginTop: "0.2rem",
                                  fontSize: "0.78rem",
                                  ...(cell.percentile != null ? (getPercentileStyle(cell.percentile) ?? {}) : {}),
                                }}
                              >
                                {cell.percentile != null ? `${Math.round(cell.percentile)}th %ile` : "—"}
                              </div>
                            )}
                            {compCellSets.map(({ label, cells: ccs }) => {
                              const cc = ccs[cellIdx];
                              return (
                                <div
                                  key={label}
                                  style={{
                                    marginTop: "0.4rem",
                                    borderTop: "1px solid rgba(255,255,255,0.07)",
                                    paddingTop: "0.3rem",
                                  }}
                                >
                                  <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.38)", marginBottom: "0.1rem" }}>
                                    {label}
                                  </div>
                                  <span style={{ fontSize: "0.88rem", color: "rgba(255,255,255,0.5)" }}>
                                    {cc && cc.valuePart !== "—" ? `${cc.valuePart}${cc.unitPart}` : "—"}
                                  </span>
                                </div>
                              );
                            })}
                          </td>
                        ))}
                      </tr>
                      {/* Kinematic sequence peak order row */}
                      {section.id === "kinematic-sequence" && Object.keys(peakOrderRanks).length > 0 && (
                        <tr>
                          {cells.map((cell) => (
                            <td key={`${section.id}-${cell.key}-peak-order`} style={{ fontSize: "0.82rem" }}>
                              {peakOrderRanks[cell.key] != null ? (
                                <span style={{ color: "rgba(255,255,255,0.55)" }}>
                                  Peak Order: <strong style={{ color: "var(--text-primary)" }}>#{peakOrderRanks[cell.key]}</strong>
                                </span>
                              ) : "—"}
                            </td>
                          ))}
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>{/* /table-scroll-wrapper */}
                {insights.length > 0 && (
                  <div
                    style={{
                      marginTop: "0.75rem",
                      padding: "0.6rem 0.75rem",
                      background: "rgba(255,255,255,0.04)",
                      borderRadius: "6px",
                      borderLeft: "3px solid rgba(255,255,255,0.15)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.4rem",
                    }}
                  >
                    {insights.map(({ label, text }) => (
                      <div key={label} style={{ fontSize: "0.8rem", lineHeight: 1.5 }}>
                        <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.65)", marginRight: "0.4rem" }}>{label}:</span>
                        <span className="text-muted">{text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      ) : domain.domainId === "hitting" ? (
        <>
          {HITTING_TABLE_SECTIONS.map((section) => {
            const cells = buildHittingDisplayCells(domain.metrics, section.items);
            const compCellSets = compDomains.map(({ label, domain: cd }) => ({
              label,
              cells: buildHittingDisplayCells(cd.metrics, section.items),
            }));
            return (
              <div key={section.id} className="card" style={{ marginBottom: "1rem" }}>
                <h3 style={{ margin: "0 0 0.35rem", fontSize: "1rem" }}>{section.title}</h3>
                <p
                  className="text-muted"
                  style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", lineHeight: 1.45 }}
                >
                  {section.description}
                </p>
                <div className="table-scroll-wrapper">
                  <table>
                    <thead>
                      <tr>
                        {cells.map((cell) => (
                          <th key={`${section.id}-${cell.key}`}>{cell.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {cells.map((cell, cellIdx) => (
                          <td key={`${section.id}-${cell.key}-value`}>
                            {cell.valuePart === "—" ? "—" : (
                              <>
                                <strong>{cell.valuePart}</strong>
                                {cell.unitPart}
                              </>
                            )}
                            <div
                              className={cell.percentile == null ? "text-muted" : undefined}
                              style={{
                                marginTop: "0.2rem",
                                fontSize: "0.78rem",
                                ...(cell.percentile != null ? (getPercentileStyle(cell.percentile) ?? {}) : {}),
                              }}
                            >
                              {cell.percentile != null ? `${Math.round(cell.percentile)}th %ile` : "—"}
                            </div>
                            {compCellSets.map(({ label, cells: ccs }) => {
                              const cc = ccs[cellIdx];
                              return (
                                <div
                                  key={label}
                                  style={{
                                    marginTop: "0.4rem",
                                    borderTop: "1px solid rgba(255,255,255,0.07)",
                                    paddingTop: "0.3rem",
                                  }}
                                >
                                  <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.38)", marginBottom: "0.1rem" }}>
                                    {label}
                                  </div>
                                  <span style={{ fontSize: "0.88rem", color: "rgba(255,255,255,0.5)" }}>
                                    {cc && cc.valuePart !== "—" ? `${cc.valuePart}${cc.unitPart}` : "—"}
                                  </span>
                                </div>
                              );
                            })}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>{/* /table-scroll-wrapper */}
              </div>
            );
          })}
        </>
      ) : domain.domainId === "mobility" ? (
        <div className="card">
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {domain.sessionDate ? (
                <tr>
                  <td
                    colSpan={3}
                    className="text-muted"
                    style={{ fontSize: "0.82rem", padding: "0.35rem 0 1.6rem", borderBottom: "none" }}
                  >
                    Session Date: {domain.sessionDate}
                  </td>
                </tr>
              ) : null}
              {buildMobilityGroupSections(domain.metrics).map((section, idx) => {
                const derivedScoreValue =
                  section.group.category === "Shoulder Mobility"
                    ? section.components.reduce((sum, component) => {
                        const score = getMobilityComponentScoreValue(component);
                        return score == null ? sum : sum + score;
                      }, 0)
                    : null;
                const scoreValue =
                  derivedScoreValue != null
                    ? derivedScoreValue
                    : section.group.value != null && Number.isFinite(section.group.value)
                      ? Math.round(section.group.value)
                      : null;
                const scoreText =
                  scoreValue != null
                    ? section.group.max != null && section.group.max > 0
                      ? `${scoreValue}/${section.group.max}`
                      : `${scoreValue}`
                    : "—";
                const percentText =
                  scoreValue != null && section.group.max != null && section.group.max > 0
                    ? `${Math.round((scoreValue / section.group.max) * 100)}%`
                    : section.group.category === "Grip Strength" &&
                        section.group.percentile != null &&
                        Number.isFinite(section.group.percentile)
                      ? `${Math.round(section.group.percentile)}th %ile`
                      : "—";
                const isGripStrength = section.group.category === "Grip Strength";
                const isExpanded = Boolean(expandedMobilityGroups[section.group.category]);
                return (
                  <Fragment key={`mobility-group-${section.group.category}`}>
                    <tr>
                      <td colSpan={3} style={{ padding: idx === 0 ? "0 0 0.55rem" : "0.9rem 0 0.55rem", borderBottom: "none" }}>
                        <div style={{ borderTop: "1px solid var(--border)" }} />
                      </td>
                    </tr>
                    <tr>
                      <td
                        style={{
                          fontSize: "1.08rem",
                          fontWeight: 700,
                          padding: "0.55rem 2.5rem 0.4rem 2.5rem",
                          borderBottom: "none",
                        }}
                      >
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem" }}>
                          <span>{section.group.mobilityDisplayLabel ?? section.group.category}</span>
                          {section.components.length > 0 ? (
                            <button
                              type="button"
                              className="btn-ghost"
                              style={{ fontSize: "0.72rem", padding: "2px 8px", lineHeight: 1.2 }}
                              onClick={() =>
                                setExpandedMobilityGroups((prev) => ({
                                  ...prev,
                                  [section.group.category]: !prev[section.group.category],
                                }))
                              }
                            >
                              {isExpanded ? "Hide details" : "Show details"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td
                        style={{
                          textAlign: "center",
                          fontSize: "1.08rem",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                          padding: "0.55rem 2.5rem 0.4rem",
                          borderBottom: "none",
                        }}
                      >
                        {scoreText}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          fontSize: "1.08rem",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                          padding: "0.55rem 2.5rem 0.4rem",
                          borderBottom: "none",
                        }}
                      >
                        {percentText}
                      </td>
                    </tr>
                    {section.components.length > 0 && isExpanded ? (
                      <tr>
                        <td colSpan={3} style={{ padding: "0.15rem 0 0.95rem", borderBottom: "none" }}>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))",
                              columnGap: "0.75rem",
                              rowGap: "0.55rem",
                              width: "100%",
                            }}
                          >
                            {section.components.map((component) => (
                              isShoulderRomMetric(component) ? (
                                <div
                                  key={`mobility-comp-${section.group.category}-${component.name}`}
                                  style={{
                                    whiteSpace: "nowrap",
                                    border: "1px solid var(--border)",
                                    borderRadius: 999,
                                    background: "var(--bg-tertiary)",
                                    padding: "6px 10px",
                                    display: "grid",
                                    gridTemplateColumns: "1fr auto auto",
                                    alignItems: "center",
                                    gap: "0.6rem",
                                  }}
                                >
                                  <span style={{ marginRight: "0.3rem", color: "var(--text-secondary)", fontSize: "0.84rem" }}>
                                    {formatMobilityComponentLabel(component, domain.domainId)}
                                  </span>
                                  <strong style={{ fontSize: "0.9rem", justifySelf: "center" }}>
                                    {formatMobilityComponentValue(component)}
                                  </strong>
                                  <strong style={{ fontSize: "0.82rem" }}>
                                    {scoreOutOfThreeFromPercentile(component.percentile)}
                                  </strong>
                                </div>
                              ) : (
                                <div
                                  key={`mobility-comp-${section.group.category}-${component.name}`}
                                  style={{
                                    whiteSpace: "nowrap",
                                    border: "1px solid var(--border)",
                                    borderRadius: 999,
                                    background: "var(--bg-tertiary)",
                                    padding: "6px 10px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: "0.6rem",
                                  }}
                                >
                                  <span style={{ marginRight: "0.3rem", color: "var(--text-secondary)", fontSize: "0.84rem" }}>
                                    {formatMobilityComponentLabel(component, domain.domainId)}
                                  </span>
                                  <strong style={{ fontSize: "0.9rem" }}>
                                    {isGripStrength
                                      ? formatMobilityComponentValue({ ...component, mobilityOutOf: null })
                                      : formatMobilityComponentValue(component)}
                                  </strong>
                                </div>
                              )
                            ))}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              <tr>
                <td colSpan={3} style={{ padding: "0.35rem 0 0", borderBottom: "none" }}>
                  <div style={{ borderTop: "1px solid var(--border)" }} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card">
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>
            Metrics{domain.sessionDate ? ` · ${domain.sessionDate}` : ""}
          </h3>
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
                {domain.metrics.map((m, i) => (
                  <tr key={`${domain.domainId}-${i}-${m.category}-${m.name}`}>
                    <td>{formatMetricDisplayName(m.name, m.category, domain.domainId)}</td>
                    <td>
                      {(() => {
                        const { valuePart, unitPart } = formatMetricValueParts(m);
                        return valuePart === "—" ? "—" : (<><strong>{valuePart}</strong>{unitPart}</>);
                      })()}
                    </td>
                    <td>
                      {m.percentile != null ? (
                        <span style={getPercentileStyle(m.percentile)}>
                          {Math.round(m.percentile)}th %ile
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>{/* /table-scroll-wrapper */}
        </div>
      )}
    </>
  );
}
