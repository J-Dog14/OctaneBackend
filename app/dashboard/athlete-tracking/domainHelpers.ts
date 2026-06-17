import type React from "react";
import type { MetricWithPercentile, DomainWithMetrics, MobilityGroupMetric, MobilityComponentMetric } from "./types";
import { PITCHING_RADAR_ALLOWLIST, HITTING_RADAR_ALLOWLIST, HIGHLIGHTS_EXCLUDE_KEYS } from "./constants";
import { formatMetricDisplayName, formatValueWithUnit } from "@/lib/athlete-tracking/displayNames";
import type { RadarMetric } from "./MetricRadarChart";
import { SCALE_3_COLUMNS, isRomDegreeColumn } from "@/lib/octane/mobilityColumnTypes";

/** One point per unique metric; value is percentile or normalized (value/max*100). */
export function metricsToRadarData(metrics: MetricWithPercentile[], domainId?: string): RadarMetric[] {
  const seen = new Set<string>();
  const out: RadarMetric[] = [];
  for (const m of metrics) {
    let chartValue: number;
    let displaySuffix: string;
    // Mobility GROUP scores are already 0-100 range-compliance values — always use
    // value/max so the radar reflects actual group performance, not a population
    // percentile that can be near-zero when the population is small.
    if (
      m.mobilityMetricKind === "GROUP" &&
      m.max != null && m.value != null && m.max > 0
    ) {
      chartValue = (m.value / m.max) * 100;
      displaySuffix = `${Math.round(m.value)}%`;
    } else if (m.percentile != null && Number.isFinite(m.percentile)) {
      chartValue = m.percentile;
      displaySuffix = `${Math.round(m.percentile)}th %ile`;
    } else if (m.max != null && m.value != null && m.max > 0) {
      chartValue = (m.value / m.max) * 100;
      displaySuffix = `${Number(m.value).toFixed(0)} / ${m.max}`;
    } else continue;
    const uniqueKey = `${m.category} – ${m.name}`;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);
    const displayName = formatMetricDisplayName(m.name, m.category, domainId);
    out.push({
      subject: displayName,
      value: chartValue,
      fullMark: 100,
      displayValue: `${displayName}: ${displaySuffix}`,
    });
  }
  return out;
}

/** Returns highlights (top 3) and lowlights (bottom 3) across all domains. */
export function getHighlightsAndLowlights(domains: DomainWithMetrics[]) {
  const all: Array<{ domainLabel: string; domainId: string; metric: MetricWithPercentile }> = [];
  for (const d of domains) {
    for (const m of d.metrics) {
      const key = m.category ? `${m.category}|${m.name}` : m.name;
      if (
        m.percentile != null &&
        Number.isFinite(m.percentile) &&
        m.mobilityMetricKind !== "GROUP" &&
        m.mobilityMetricKind !== "COMPONENT" &&
        !HIGHLIGHTS_EXCLUDE_KEYS.has(key)
      ) {
        all.push({ domainLabel: d.label, domainId: d.domainId, metric: m });
      }
    }
  }
  all.sort((a, b) => (b.metric.percentile ?? 0) - (a.metric.percentile ?? 0));
  return { highlights: all.slice(0, 3), lowlights: all.slice(-3).reverse() };
}

export function getPercentileStyle(percentile: number | null): React.CSSProperties | undefined {
  if (percentile == null) return undefined;
  if (percentile > 85) return { color: "#16a34a" };
  if (percentile > 60) return { color: "#4ade80" };
  if (percentile > 40) return { color: "var(--text-primary)" };
  if (percentile > 15) return { color: "#f59e0b" };
  return { color: "var(--accent-secondary)" };
}

export function formatMetricValueParts(metric: MetricWithPercentile): { valuePart: string; unitPart: string } {
  return formatValueWithUnit(metric.value, metric.valueUnit, metric.max);
}

export function getMetricByKey(metrics: MetricWithPercentile[], key: string): MetricWithPercentile | null {
  for (const metric of metrics) {
    if (`${metric.category}|${metric.name}` === key) return metric;
  }
  return null;
}

export function getMetricValueFromDomain(d: { metrics: MetricWithPercentile[] } | undefined, key: string): string {
  if (!d) return "—";
  const metric = getMetricByKey(d.metrics, key);
  if (!metric) return "—";
  const { valuePart, unitPart } = formatMetricValueParts(metric);
  return valuePart === "—" ? "—" : `${valuePart}${unitPart}`;
}

export function getRadarMetricsForDomain(
  metrics: MetricWithPercentile[],
  domainId: string
): MetricWithPercentile[] {
  if (domainId === "pitching") {
    return metrics.filter((m) => PITCHING_RADAR_ALLOWLIST.has(`${m.category}|${m.name}`));
  }
  if (domainId === "hitting") {
    return metrics.filter((m) => HITTING_RADAR_ALLOWLIST.has(`${m.category}|${m.name}`));
  }
  if (domainId === "mobility") {
    return metrics.filter((m) => m.mobilityMetricKind === "GROUP");
  }
  return metrics;
}

/** Key radar metrics to show per domain in the timeline table. */
export function getTimelineMetricKeys(domainId: string): string[] {
  if (domainId === "pitching") {
    return [
      "TRACKMAN_METRICS|VELOCITY",
      "SUBJECT_METRICS|SCORE",
      "HIP_SHOULDER_SEPARATION|FOOT_PLANT",
      "ABDUCTION|FOOT_PLANT",
      "KINEMATIC_SEQUENCE|PELVIS",
      "KINEMATIC_SEQUENCE|TORSO",
      "KINEMATIC_SEQUENCE|ARM",
      "GRF|MID_POINT",
    ];
  }
  if (domainId === "hitting") {
    return [
      "PROCESSED|Max_Pelvis_Ang_Vel",
      "PROCESSED|Max_Thorax_Ang_Vel",
      "PROCESSED|Max_Lead_Forearm_Ang_Vel",
      "PROCESSED|Max_Lead_Hand_Ang_Vel",
      "PROCESSED|Max_Bat_Ang_Vel",
      "PROCESSED|Pelvis_Shoulders_Separation@Lead_Foot_Down",
    ];
  }
  if (domainId === "armAction") {
    return [
      "ARM_ACTION|Score",
      "ARM_ACTION|Abduction",
      "ARM_ACTION|MER",
      "ARM_ACTION|Arm Velo",
      "ARM_ACTION|Torso Velo",
    ];
  }
  return [];
}

/** Returns a threshold-based insight string for a given metric key + value. */
export function getMetricInsight(key: string, value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  switch (key) {
    case "GRF|MID_POINT":
      if (value > 2.41) return "Elite: Exceptional lead leg force production. Peak GRF is a major velocity and injury resilience driver.";
      if (value > 2.14) return "Above Average: Strong lead leg force — your front side is doing its job well.";
      if (value > 2.02) return "Average: Adequate lead leg force. Small improvements here can meaningfully impact velocity.";
      if (value > 1.69) return "Developing: Lead leg force production is below average. Focus on front leg strength and stability.";
      return "Needs Improvement: Low lead leg GRF. Significant opportunity to build front side power and improve energy transfer.";
    case "FRONT_LEG|EXTENSION":
      if (value > 29.27) return "Elite: Outstanding lead leg block — your front side is stopping momentum and redirecting force efficiently.";
      if (value > 19.00) return "Above Average: Good lead leg block. Front leg is providing solid resistance at release.";
      if (value > 12.79) return "Average: Moderate lead leg block. Strengthening front leg stability can improve energy transfer.";
      if (value > 4.05) return "Developing: Weak lead leg block. The front side is collapsing through release, limiting energy transfer.";
      return "Needs Improvement: Very limited lead leg block. Priority area — front leg stability is critical for velocity and arm health.";
    case "PELVIS_ROTATION|FOOT_PLANT":
      if (value > 60.42) return "Elite: Pelvis is very open at foot contact — excellent lower half lead allowing great separation potential.";
      if (value > 49.56) return "Above Average: Good pelvic rotation at foot contact. Lower half is driving well.";
      if (value > 42.11) return "Average: Adequate pelvis position at foot contact. More hip lead could improve energy transfer.";
      if (value > 31.10) return "Developing: Pelvis is relatively closed at foot contact. Working on hip clearance timing may improve velocity.";
      return "Needs Improvement: Pelvis is significantly closed at foot contact. Lower half timing and hip mobility should be prioritized.";
    case "KINEMATIC_SEQUENCE|TORSO":
      if (value > 1207.66) return "Elite: Exceptional torso angular velocity — upper half is contributing maximally to arm speed.";
      if (value > 1132.72) return "Above Average: Strong torso contribution. Upper half sequencing is efficient.";
      if (value > 1070.21) return "Average: Adequate torso velocity. Improving torso contribution can meaningfully increase arm speed.";
      if (value > 985.71) return "Developing: Below average torso velocity. Upper half may not be efficiently transferring lower half energy.";
      return "Needs Improvement: Low torso angular velocity. Sequencing issues may be limiting arm speed and increasing stress.";
    case "HIP_SHOULDER_SEPARATION|FOOT_PLANT":
      if (value > 59.10) return "Elite: Outstanding hip-shoulder separation — maximum stretch-shortening potential at foot contact.";
      if (value > 51.46) return "Above Average: Good separation. Your trunk muscles are loaded well at foot contact.";
      if (value > 45.87) return "Average: Moderate separation. Increasing upper-lower dissociation can improve velocity.";
      if (value > 38.78) return "Developing: Limited hip-shoulder separation. Working on keeping the torso closed while opening hips may help.";
      return "Needs Improvement: Very limited separation at foot contact. This is a significant velocity and efficiency limiter.";
    case "HIP_SHOULDER_PROGRESS|GAIN_OR_LOSS":
      if (value >= 1) return "Gain: Hip-shoulder separation increases after foot contact — elastic energy is being added through the stride.";
      return "Loss: Hip-shoulder separation decreases after foot contact — some stored elastic energy may be lost before it can be used.";
    case "TRUNK_POSITION|FOOT_PLANT":
      if (value > 108.89) return "Elite: Torso stays very closed at foot contact — excellent upper half timing relative to the lower half.";
      if (value > 96.95) return "Above Average: Good torso position at foot contact. Upper half is well-timed.";
      if (value > 90.91) return "Average: Adequate torso position. Small improvements in timing could increase separation.";
      if (value > 82.66) return "Developing: Torso is opening early at foot contact. This reduces separation and may increase arm stress.";
      return "Needs Improvement: Torso is significantly early — upper half is leading the lower half, which reduces energy transfer and increases injury risk.";
    case "LATERAL_TILT|RELEASE":
      if (value > 48.69) return "Elite: Excellent lateral trunk tilt at release — optimal arm path and shoulder layback position.";
      if (value > 40.67) return "Above Average: Good lateral tilt. Arm position at release is well-supported.";
      if (value > 34.37) return "Average: Moderate lateral tilt. Increasing trunk lean may improve arm path efficiency.";
      if (value > 27.43) return "Developing: Limited lateral tilt at release. May be reducing arm extension and layback.";
      return "Needs Improvement: Minimal lateral tilt at release. Trunk position is limiting arm path and likely increasing shoulder stress.";
    case "ABDUCTION|FOOT_PLANT":
      if (value < -59.06) return "Elite: Maximum scap load at foot contact — arm is trailing perfectly behind the body.";
      if (value < -48.48) return "Above Average: Good horizontal abduction at foot contact. Arm is well-loaded.";
      if (value < -42.03) return "Average: Adequate scap load. Maintaining more abduction at foot contact may improve arm sync.";
      if (value < -30.72) return "Developing: Limited scap load at foot contact. Arm may be getting ahead of the body too early.";
      return "Needs Improvement: Very limited horizontal abduction — arm is not trailing the body effectively, reducing velocity potential and increasing stress.";
    case "SHOULDER_EXTERNAL_ROTATION|MAX":
      if (value > 226.17) return "Elite: Exceptional layback — maximum shoulder mobility and sequencing for velocity generation.";
      if (value > 174.92) return "Above Average: Good layback. Arm is reaching sufficient external rotation to generate velocity efficiently.";
      if (value > 152.54) return "Average: Moderate layback. Improving flexibility and timing could increase max ER and velocity.";
      if (value > 66.47) return "Developing: Limited layback. Insufficient external rotation may be capping velocity and increasing arm stress.";
      return "Needs Improvement: Very limited max external rotation. Mobility and sequencing work is needed to protect the arm and maximize velocity.";
    case "SHOULDER_ER|FOOT_PLANT": {
      if (value < 33) return "Late: Arm is behind at foot contact (< 33°). Late arm timing increases stress on the shoulder and elbow.";
      if (value <= 77) return "On Time: Arm position at foot contact is in the ideal window (33–77°). Good timing allows the arm to sync with the body.";
      return "Early: Arm is ahead at foot contact (> 77°). Early arm timing can increase stress and reduce sequencing efficiency.";
    }
    default:
      return null;
  }
}

// ── Mobility helpers ──────────────────────────────────────────────────────────

export function isShoulderRomMetric(m: MetricWithPercentile): boolean {
  return m.mobilityGroup === "Shoulder Mobility";
}

export function getMobilityComponentScoreValue(m: MetricWithPercentile): number | null {
  if (m.mobilityOutOf == null || m.mobilityOutOf === 0) return null;
  if (m.value == null || !Number.isFinite(m.value)) return null;
  return m.value;
}

export function scoreOutOfThreeFromPercentile(percentile: number | null): string {
  if (percentile == null) return "—";
  if (percentile >= 66) return "3/3";
  if (percentile >= 33) return "2/3";
  return "1/3";
}

export function formatMobilityComponentLabel(m: MetricWithPercentile, domainId?: string): string {
  if (m.mobilityDisplayLabel) return m.mobilityDisplayLabel;
  return formatMetricDisplayName(m.name, m.category, domainId);
}

export function formatMobilityComponentValue(m: MetricWithPercentile): string {
  const key = m.name;
  const raw = m.value != null ? Number(m.value) : NaN;
  const valid = Number.isFinite(raw);
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  if (SCALE_3_COLUMNS.has(key))        return valid ? `${fmt(raw)}/3` : "—";
  if (key === "hawkins_kennedy_test")   return valid ? (raw === 0 ? "Negative" : "Positive") : "—";
  if (key.endsWith("_mmt"))            return valid ? fmt(raw) : "—";
  if (isRomDegreeColumn(key))          return valid ? `${fmt(raw)}°` : "—";

  const { valuePart, unitPart } = formatValueWithUnit(m.value, m.valueUnit, null);
  return valuePart === "—" ? "—" : `${valuePart}${unitPart}`;
}

/** Returns a compact optimal-range string for the pill, or null if no range should be shown. */
export function condenseMobilityOptimalRange(key: string, raw: string | null): string | null {
  if (!raw) return null;

  // 3-point scale: "X/3" display makes range redundant
  if (SCALE_3_COLUMNS.has(key)) return null;

  // Categorical
  if (key === "hawkins_kennedy_test") return "Negative";

  // T-spine PVC: tiered range — show average zone only
  if (key === "sittiing_t_spine_pvc_r" || key === "sittiing_t_spine_pvc_l") return "70-80";

  // Grip L comparison
  if (key === "gs_l" || key === "gs_l_at_90") return "R ±10%";

  // "80+" bare → "≥80"
  if (/^\d+\+$/.test(raw.trim())) return `≥${raw.trim().slice(0, -1)}`;

  // "Within X% of dominant..." → "R ±X%"
  const withinDom = raw.match(/within\s+(\d+(?:[-–]\d+)?)\s*%.*dominant/i);
  if (withinDom) return `R ±${withinDom[1]}%`;

  // "Within X-Y% of..." generic → "±X-Y%"
  const withinPct = raw.match(/within\s+(\d+[-–]\d+)\s*%/i);
  if (withinPct) return `±${withinPct[1]}%`;

  // Already short: use as-is
  if (raw.trim().length <= 12) return raw.trim();

  return raw.trim().slice(0, 10) + "…";
}

/** Border color for a component pill based on its 0–100 range score. */
export function getMobilityRangeColor(rangeScore: number | null | undefined): string {
  if (rangeScore == null) return "var(--border)";
  if (rangeScore >= 80) return "#16a34a";
  if (rangeScore >= 50) return "#f59e0b";
  return "var(--accent-secondary)";
}

export function buildMobilityGroupSections(metrics: MetricWithPercentile[]): Array<{
  group: MobilityGroupMetric;
  components: MobilityComponentMetric[];
}> {
  const groups = metrics.filter((m) => m.mobilityMetricKind === "GROUP") as MobilityGroupMetric[];
  return groups.map((group) => ({
    group,
    components: metrics.filter(
      (m) => m.mobilityMetricKind === "COMPONENT" && m.mobilityGroup === group.category
    ) as MobilityComponentMetric[],
  }));
}
