"use client";

import { Fragment, useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  TextInput,
  Badge,
  Select,
  Tabs,
  TabsList,
  TabsTab,
  Tooltip,
  ActionIcon,
  Title,
  Text,
  Card,
  Group,
  Stack,
} from "@mantine/core";
import { MetricRadarChart, type RadarMetric, type RadarDataSeries, SERIES_COLORS } from "./MetricRadarChart";
import { MetricLineChart } from "./MetricLineChart";
import { formatMetricDisplayName, formatValueWithUnit } from "@/lib/athlete-tracking/displayNames";

type AthleteItem = {
  athlete_uuid: string;
  name: string;
};

type MetricWithPercentile = {
  category: string;
  name: string;
  value: number | null;
  valueUnit: string;
  orientation: string | null;
  percentile: number | null;
  max?: number | null;
  mobilityMetricKind?: "GROUP" | "COMPONENT";
  mobilityGroup?: string;
  mobilityDisplayLabel?: string;
  mobilityOutOf?: number | null;
};

type DomainWithMetrics = {
  domainId: string;
  label: string;
  metrics: MetricWithPercentile[];
  sessionDate?: string | null;
};

type AthleteTrackingReport = {
  generatedAt: string;
  athlete: {
    athleteUuid: string;
    name: string;
    dateOfBirth?: string | null;
    gender?: string | null;
    height?: string | null;
    weight?: string | null;
    email?: string | null;
  };
  counts: Record<string, number>;
  domains: DomainWithMetrics[];
};

/** Pitching radar shows only these category|name pairs; table still shows all metrics. */
const PITCHING_RADAR_ALLOWLIST = new Set([
  "HIP_SHOULDER_SEPARATION|MAX_ER",
  "ABDUCTION|FOOT_PLANT",
  "SUBJECT_METRICS|SCORE",
  "TRACKMAN_METRICS|VELOCITY",
  "KINEMATIC_SEQUENCE|PELVIS",
  "KINEMATIC_SEQUENCE|TORSO",
  "KINEMATIC_SEQUENCE|ARM",
  "SHOULDER_EXTERNAL_ROTATION|MAX",
  "GRF|MID_POINT",
]);

const HITTING_RADAR_ALLOWLIST = new Set([
  "PROCESSED|Max_Bat_Ang_Vel",
  "PROCESSED|Max_Pelvis_Ang_Vel",
  "PROCESSED|Max_Thorax_Ang_Vel",
  "PROCESSED|Max_Lead_Hand_Ang_Vel",
  "PROCESSED|Max_Lead_Forearm_Ang_Vel",
  "PROCESSED|Pelvis_Shoulders_Separation@Lead_Foot_Down",
  "PROCESSED|Max_RPV_CGPos_VLab_Linear_Vel",
  "PROCESSED|Max_RTA_CGPos_VLab_Linear_Vel",
]);

/** One point per unique metric; value is percentile or normalized (value/max*100) for mobility categories. */
function metricsToRadarData(metrics: MetricWithPercentile[], domainId?: string): RadarMetric[] {
  const seen = new Set<string>();
  const out: RadarMetric[] = [];
  for (const m of metrics) {
    let chartValue: number;
    let displaySuffix: string;
    if (m.percentile != null && Number.isFinite(m.percentile)) {
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
function getHighlightsAndLowlights(domains: DomainWithMetrics[]) {
  const all: Array<{ domainLabel: string; domainId: string; metric: MetricWithPercentile }> = [];
  for (const d of domains) {
    for (const m of d.metrics) {
      if (
        m.percentile != null &&
        Number.isFinite(m.percentile) &&
        m.mobilityMetricKind !== "GROUP" &&
        m.mobilityMetricKind !== "COMPONENT"
      ) {
        all.push({ domainLabel: d.label, domainId: d.domainId, metric: m });
      }
    }
  }
  all.sort((a, b) => (b.metric.percentile ?? 0) - (a.metric.percentile ?? 0));
  return { highlights: all.slice(0, 3), lowlights: all.slice(-3).reverse() };
}

function getPercentileStyle(percentile: number | null): React.CSSProperties | undefined {
  if (percentile == null) return undefined;
  if (percentile >= 75) return { color: "#16a34a" };
  if (percentile <= 25) return { color: "var(--accent-secondary)" };
  return { color: "var(--text-primary)" };
}

function formatMetricValueParts(metric: MetricWithPercentile): { valuePart: string; unitPart: string } {
  return formatValueWithUnit(metric.value, metric.valueUnit, metric.max);
}

/** Mobility helpers */
type MobilityGroupMetric = MetricWithPercentile & { mobilityMetricKind: "GROUP" };
type MobilityComponentMetric = MetricWithPercentile & { mobilityMetricKind: "COMPONENT" };

function isShoulderRomMetric(m: MetricWithPercentile): boolean {
  return m.mobilityGroup === "Shoulder Mobility";
}

function getMobilityComponentScoreValue(m: MetricWithPercentile): number | null {
  if (m.mobilityOutOf == null || m.mobilityOutOf === 0) return null;
  if (m.value == null || !Number.isFinite(m.value)) return null;
  return m.value;
}

function scoreOutOfThreeFromPercentile(percentile: number | null): string {
  if (percentile == null) return "—";
  if (percentile >= 66) return "3/3";
  if (percentile >= 33) return "2/3";
  return "1/3";
}

function formatMobilityComponentLabel(m: MetricWithPercentile, domainId?: string): string {
  return formatMetricDisplayName(m.name, m.category, domainId);
}

function formatMobilityComponentValue(m: MetricWithPercentile): string {
  const { valuePart, unitPart } = formatValueWithUnit(m.value, m.valueUnit, m.mobilityOutOf ?? m.max);
  if (valuePart === "—") return "—";
  if (m.mobilityOutOf != null && m.mobilityOutOf > 0 && m.value != null) {
    return `${valuePart}/${m.mobilityOutOf}`;
  }
  return `${valuePart}${unitPart}`;
}

function buildMobilityGroupSections(metrics: MetricWithPercentile[]): Array<{
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

function getRadarMetricsForDomain(
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

/** ---- Pitching table section types ---- */
type PitchingSectionMetricItem = { kind: "metric"; key: string; label: string };
type PitchingSectionDerivedItem = { kind: "derived"; derivedId: string; label: string };
type PitchingSection = {
  id: string;
  title?: string;
  description: string;
  items: Array<PitchingSectionMetricItem | PitchingSectionDerivedItem>;
};
type PitchingDisplayCell = {
  key: string;
  label: string;
  valuePart: string;
  unitPart: string;
  percentile: number | null;
};
type HittingSectionMetricItem = { key: string; label: string };
type HittingSection = {
  id: string;
  title: string;
  description: string;
  items: HittingSectionMetricItem[];
};

const PITCHING_TABLE_SECTIONS: PitchingSection[] = [
  {
    id: "velocity",
    title: "Velocity / Score",
    description:
      "Trackman velocity and overall pitching score. Velocity is the primary output metric; score aggregates key kinematic contributors.",
    items: [
      { kind: "metric", key: "TRACKMAN_METRICS|VELOCITY", label: "Velocity" },
      { kind: "metric", key: "SUBJECT_METRICS|SCORE", label: "Score" },
    ],
  },
  {
    id: "grf",
    title: "Ground Reaction Force",
    description:
      "Ground reaction force mid-point is the percentage of stride completed when peak vertical GRF occurs. Earlier midpoint values generally indicate better energy transfer.",
    items: [
      { kind: "metric", key: "GRF|MID_POINT", label: "GRF Mid-Point" },
    ],
  },
  {
    id: "lead-leg",
    title: "Lead Leg Block",
    description:
      "An efficient lead leg block occurs when the front leg is positioned and strong enough to stop forward momentum and redirect force back up the body at ball release. A stronger, more stable block improves energy transfer.",
    items: [
      { kind: "metric", key: "FRONT_LEG|EXTENSION", label: "Lead Leg Block" },
      { kind: "metric", key: "FRONT_LEG|FOOT_PLANT", label: "Knee Flexion @ Footplant" },
      { kind: "metric", key: "FRONT_LEG|RELEASE", label: "Knee Flexion @ Release" },
    ],
  },
  {
    id: "pelvis",
    title: "Pelvis Rotation",
    description:
      "The pelvis is a primary driver of velocity. As it rotates toward home plate, it allows the lower half to clear while the upper half stays back. More open at foot contact generally allows better energy transfer up the chain.",
    items: [
      { kind: "metric", key: "PELVIS_ROTATION|FOOT_PLANT", label: "Pelvis @ Footplant" },
      { kind: "metric", key: "PELVIC_OBLIQUITY|TOTAL", label: "Pelvic Obliquity (FP to Release)" },
    ],
  },
  {
    id: "hip-shoulder-separation",
    title: "Hip-Shoulder Separation",
    description:
      "Hip-shoulder separation occurs when the pelvis rotates toward home while the torso remains closed at and shortly after foot contact. This creates stretch across large trunk muscles, allowing stored elastic energy to transfer into the throw.",
    items: [
      { kind: "metric", key: "HIP_SHOULDER_SEPARATION|FOOT_PLANT", label: "HSS @ Footplant" },
      { kind: "derived", derivedId: "MAX_HSS", label: "Max HSS" },
      { kind: "metric", key: "HIP_SHOULDER_PROGRESS|GAIN_OR_LOSS", label: "Gain or Loss" },
      { kind: "metric", key: "HIP_SHOULDER_PROGRESS|AMOUNT_TO_PEAK", label: "Diff FP to Peak" },
      { kind: "metric", key: "HIP_SHOULDER_PROGRESS|PEAK_AFTER_FOOTSTRIKE_MS", label: "Time to Peak" },
      { kind: "metric", key: "HIP_SHOULDER_PROGRESS|POST_PEAK_LOSS_RATE", label: "Rate of Loss" },
    ],
  },
  {
    id: "torso",
    title: "Torso Position",
    description:
      "The torso connects the lower half to the arm. Staying closed at and shortly after foot contact allows energy to transfer efficiently while reducing stress on the shoulder and elbow.",
    items: [
      { kind: "metric", key: "TRUNK_POSITION|FOOT_PLANT", label: "Torso @ Footplant" },
      { kind: "metric", key: "TOTAL_TRUNK_FLEXION|TOTAL", label: "Total Torso Flexion (FP to Release)" },
      { kind: "metric", key: "LATERAL_TILT|RELEASE", label: "Lateral Tilt @ Release" },
    ],
  },
  {
    id: "horizontal-abduction",
    title: "Horizontal Abduction (Scap Load)",
    description:
      "Often called \"scap load,\" horizontal abduction allows the arm to properly trail the body down the mound. The key is maintaining sufficient abduction at and shortly after foot contact - this ensures the arm stays synced with the lower half and allows efficient energy transfer. The more scap load maintained through this window, the better.",
    items: [
      { kind: "metric", key: "ABDUCTION|FOOT_PLANT", label: "Abduction @ Footplant" },
      { kind: "metric", key: "ABDUCTION|MAX", label: "Max Abduction" },
      { kind: "metric", key: "ABDUCTION_PROGRESS|GAIN_OR_LOSS", label: "Gain or Loss" },
      { kind: "metric", key: "ABDUCTION_PROGRESS|AMOUNT_TO_PEAK", label: "Diff FP to Peak" },
      { kind: "metric", key: "ABDUCTION_PROGRESS|PEAK_AFTER_FOOTSTRIKE_MS", label: "Time to Peak" },
      { kind: "metric", key: "ABDUCTION_PROGRESS|POST_PEAK_LOSS_RATE", label: "Rate of Loss" },
    ],
  },
  {
    id: "shoulder-external-rotation",
    title: "Shoulder External Rotation",
    description:
      "Arm position at foot contact reflects timing. 33-77 degrees = On time; below 33 degrees = Late; above 77 degrees = Early. Being on time allows the arm to sync with the body and reduces stress on the shoulder and elbow. Max external rotation, or layback, reflects mobility and proper sequencing. Ideally >=180 degrees. Adequate layback allows for better velocity while reducing shoulder stress.",
    items: [
      { kind: "metric", key: "SHOULDER_ER|FOOT_PLANT", label: "Shoulder ER @ Footplant" },
      { kind: "derived", derivedId: "ARM_TIMING_FLAG", label: "Arm Timing Flag" },
      { kind: "metric", key: "SHOULDER_EXTERNAL_ROTATION|MAX", label: "Max External Rotation (Layback)" },
    ],
  },
  {
    id: "kinematic-sequence",
    title: "Kinematic Sequence",
    description:
      "Kinematic sequence refers to the order and timing of how body segments accelerate during the throw. Ideally, energy flows from the ground -> hips -> torso -> arm -> ball in a smooth, progressive pattern. Proper sequencing maximizes velocity while minimizing stress.",
    items: [
      { kind: "metric", key: "KINEMATIC_SEQUENCE|PELVIS", label: "Pelvis Ang Velo" },
      { kind: "metric", key: "KINEMATIC_SEQUENCE|TORSO", label: "Torso Ang Velo" },
      { kind: "metric", key: "KINEMATIC_SEQUENCE|ARM", label: "Arm Ang Velo" },
      { kind: "metric", key: "SHOULDER_EXTERNAL_ROTATION|MAX", label: "Max External Rotation" },
    ],
  },
];

const HITTING_TABLE_SECTIONS: HittingSection[] = [
  {
    id: "kinematic-sequence",
    title: "Kinematic Sequence",
    description:
      "Kinematic sequence tracks the order and peak magnitude of segment angular velocities through the swing.",
    items: [
      { key: "PROCESSED|Max_Pelvis_Ang_Vel", label: "Pelvis Velo" },
      { key: "PROCESSED|Max_Thorax_Ang_Vel", label: "Trunk Velo" },
      { key: "PROCESSED|Max_Lead_Forearm_Ang_Vel", label: "Arm Velo" },
      { key: "PROCESSED|Max_Lead_Hand_Ang_Vel", label: "Hand Velo" },
      { key: "PROCESSED|Max_Bat_Ang_Vel", label: "Bat Velo" },
    ],
  },
  {
    id: "bat-attack-and-distance",
    title: "Bat Attack Angles",
    description:
      "Attack angles and travelled distance describe the path and coverage of the bat through contact.",
    items: [
      { key: "PLANE|Horizontal_attack_angle", label: "Horizontal Attack Angle" },
      { key: "PLANE|Vertical_attack_angle", label: "Vertical Attack Angle" },
      { key: "PROCESSED|Bat_travelled_distance_max", label: "Bat Travelled Distance" },
    ],
  },
  {
    id: "bat-contact-angles",
    title: "Bat Angles @ Contact",
    description:
      "Bat orientation at contact captures how the barrel is presented in frontal, sagittal, and transversal planes.",
    items: [
      { key: "PLANE|Bat_Angle_Frontal@Contact", label: "Frontal @ Contact" },
      { key: "PLANE|Bat_Angle_Sagittal@Contact", label: "Sagittal @ Contact" },
      { key: "PLANE|Bat_Angle_Transversal@Contact", label: "Transversal @ Contact" },
    ],
  },
  {
    id: "lead-knee-block",
    title: "Lead Knee Block",
    description:
      "Lead-leg extension captures block quality, followed by lead-knee position at foot contact and at ball contact.",
    items: [
      { key: "PROCESSED|Lead_Knee_Extension", label: "Lead Knee Extension" },
      { key: "PROCESSED|Lead_Knee_Angle@Lead_Foot_Down", label: "Lead Knee Angle @ FC" },
      { key: "PROCESSED|Lead_Knee_Angle@Contact", label: "Lead Knee Angle @ Contact" },
    ],
  },
  {
    id: "pelvis",
    title: "Pelvis",
    description:
      "Pelvis positioning at lead foot down and contact, plus total pelvis rotation across that window.",
    items: [
      { key: "PROCESSED|Pelvis_Angle@Lead_Foot_Down", label: "Pelvis @ Lead Foot Down" },
      { key: "PROCESSED|Pelvis_Angle@Contact", label: "Pelvis @ Contact" },
      { key: "PROCESSED|Pelvis_Total_Rotation", label: "Total Pelvis Rotation" },
    ],
  },
  {
    id: "hip-shoulder-separation",
    title: "Hip-Shoulder Separation",
    description:
      "Separation values across key swing events show how the pelvis and trunk load/unload through the motion.",
    items: [
      { key: "PROCESSED|Pelvis_Shoulders_Separation@Setup", label: "Separation @ Setup" },
      { key: "PROCESSED|Pelvis_Shoulders_Separation@Lead_Foot_Down", label: "Separation @ Lead Foot Down" },
      { key: "PROCESSED|Pelvis_Shoulders_Separation@Downswing", label: "Separation @ Downswing" },
      { key: "PROCESSED|Pelvis_Shoulders_Separation@Max_Bat_Ang_Vel", label: "Separation @ Max Bat Velo" },
      {
        key: "PROCESSED|Pelvis_Shoulders_Separation@Max_Lead_Hand_Ang_Vel",
        label: "Separation @ Max Hand Velo",
      },
      { key: "PROCESSED|Pelvis_Shoulders_Separation@Contact", label: "Separation @ Contact" },
    ],
  },
  {
    id: "trunk",
    title: "Trunk",
    description:
      "Trunk positioning at lead foot down and contact, plus total trunk rotation across that window.",
    items: [
      { key: "PROCESSED|Trunk_Angle@Lead_Foot_Down", label: "Trunk @ Lead Foot Down" },
      { key: "PROCESSED|Trunk_Angle@Contact", label: "Trunk @ Contact" },
      { key: "PROCESSED|Trunk_Total_Rotation", label: "Total Trunk Rotation" },
    ],
  },
  {
    id: "stride-width",
    title: "Stride Width",
    description:
      "Stride width at lead foot down helps contextualize lower-half positioning and base stability.",
    items: [
      { key: "PROCESSED|Stride_Width@Lead_Foot_Down", label: "Stride Width @ Lead Foot Down" },
    ],
  },
];

function getMetricByKey(metrics: MetricWithPercentile[], key: string): MetricWithPercentile | null {
  for (const metric of metrics) {
    if (`${metric.category}|${metric.name}` === key) return metric;
  }
  return null;
}

function buildPitchingDisplayCells(
  metrics: MetricWithPercentile[],
  items: Array<PitchingSectionMetricItem | PitchingSectionDerivedItem>
): PitchingDisplayCell[] {
  return items.map((item) => {
    if (item.kind === "metric") {
      const metric = getMetricByKey(metrics, item.key);
      if (!metric) {
        return {
          key: item.key,
          label: item.label,
          valuePart: "—",
          unitPart: "",
          percentile: null,
        };
      }
      if (
        item.key === "HIP_SHOULDER_PROGRESS|AMOUNT_TO_PEAK" ||
        item.key === "ABDUCTION_PROGRESS|AMOUNT_TO_PEAK"
      ) {
        const gainKey = item.key.startsWith("HIP_SHOULDER_PROGRESS")
          ? "HIP_SHOULDER_PROGRESS|GAIN_OR_LOSS"
          : "ABDUCTION_PROGRESS|GAIN_OR_LOSS";
        const gainMetric = getMetricByKey(metrics, gainKey);
        if (gainMetric?.value === 0 || gainMetric?.value === -1) {
          const zero = formatValueWithUnit(0, metric.valueUnit, metric.max);
          return {
            key: item.key,
            label: item.label,
            valuePart: "0",
            unitPart: zero.unitPart,
            percentile: metric.percentile,
          };
        }
      }
      const { valuePart, unitPart } = formatMetricValueParts(metric);
      return {
        key: item.key,
        label: item.label,
        valuePart,
        unitPart,
        percentile: metric.percentile,
      };
    }

    if (item.derivedId === "MAX_HSS") {
      const footPlant = getMetricByKey(metrics, "HIP_SHOULDER_SEPARATION|FOOT_PLANT")?.value;
      const amountToPeak = getMetricByKey(metrics, "HIP_SHOULDER_PROGRESS|AMOUNT_TO_PEAK")?.value;
      const maxHss =
        footPlant != null && Number.isFinite(footPlant)
          ? footPlant + Math.max(amountToPeak ?? 0, 0)
          : null;
      const { valuePart, unitPart } = formatValueWithUnit(maxHss, "DEGREES");
      return {
        key: "DERIVED|MAX_HSS",
        label: item.label,
        valuePart,
        unitPart,
        percentile: null,
      };
    }

    const armTimingSource = getMetricByKey(metrics, "SHOULDER_ER|FOOT_PLANT")?.value;
    let armTimingFlag = "—";
    if (armTimingSource != null && Number.isFinite(armTimingSource)) {
      if (armTimingSource < 33) armTimingFlag = "LATE";
      else if (armTimingSource > 77) armTimingFlag = "EARLY";
      else armTimingFlag = "ON_TIME";
    }
    return {
      key: "DERIVED|ARM_TIMING_FLAG",
      label: item.label,
      valuePart: armTimingFlag,
      unitPart: "",
      percentile: null,
    };
  });
}

function buildHittingDisplayCells(
  metrics: MetricWithPercentile[],
  items: HittingSectionMetricItem[]
): PitchingDisplayCell[] {
  return items.map((item) => {
    const metric = getMetricByKey(metrics, item.key);
    if (!metric) {
      return {
        key: item.key,
        label: item.label,
        valuePart: "—",
        unitPart: "",
        percentile: null,
      };
    }
    const { valuePart, unitPart } = formatMetricValueParts(metric);
    return {
      key: item.key,
      label: item.label,
      valuePart,
      unitPart,
      percentile: metric.percentile,
    };
  });
}

// ---------------------------------------------------------------------------
// Timeline helpers
// ---------------------------------------------------------------------------

/** Key radar metrics to show per domain in the timeline table. */
function getTimelineMetricKeys(domainId: string): string[] {
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

function AthleteTrackingContentInner() {
  const searchParams = useSearchParams();
  const initialAthlete = searchParams.get("athlete") ?? "";
  const initialCurrent = searchParams.get("current") ?? "";

  const [searchResults, setSearchResults] = useState<AthleteItem[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  /** Names looked up so far; used for tracked-athlete badge labels. */
  const [knownNames, setKnownNames] = useState<Record<string, string>>({});
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlPreloadDoneRef = useRef(false);
  const [trackedUuids, setTrackedUuids] = useState<string[]>([]);
  const [currentUuid, setCurrentUuid] = useState<string>("");
  const [report, setReport] = useState<AthleteTrackingReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [athleticScreenSubIndex, setAthleticScreenSubIndex] = useState(0);
  const [expandedMobilityGroups, setExpandedMobilityGroups] = useState<Record<string, boolean>>({});
  const [addAthleteQuery, setAddAthleteQuery] = useState("");

  // --- Session date comparison (primary mode) ---
  const [availableDates, setAvailableDates] = useState<Record<string, string[]>>({});
  const [loadingDates, setLoadingDates] = useState(false);
  // domainId -> array of comparison dates (up to 3)
  const [domainCompareDates, setDomainCompareDates] = useState<Record<string, string[]>>({});
  // keyed by "domainId|date"; undefined = not fetched, null = failed, report = success
  const [compCache, setCompCache] = useState<Record<string, AthleteTrackingReport | null | undefined>>({});
  const [compLoadingKeys, setCompLoadingKeys] = useState<string[]>([]);
  // per domain: "compare" (radar) | "timeline"
  const [domainViewMode, setDomainViewMode] = useState<Record<string, "compare" | "timeline">>({});

  // --- Cross-athlete comparison (secondary) ---
  const [domainCompareMode, setDomainCompareMode] = useState<Record<string, "none" | "date" | "athlete">>({});
  const [compareUuid, setCompareUuid] = useState<string | null>(null);
  const [compareReport, setCompareReport] = useState<AthleteTrackingReport | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [expandedAthleticInfo, setExpandedAthleticInfo] = useState<string | null>(null);

  const searchAthletes = useCallback(async (q: string) => {
    setLoadingSearch(true);
    const params = new URLSearchParams({ limit: "40" });
    if (q.trim()) params.set("q", q.trim());
    try {
      const res = await fetch(`/api/dashboard/athletes?${params}`);
      const data = await res.json();
      const items: AthleteItem[] = data.items ?? [];
      setSearchResults(items);
      setKnownNames((prev) => {
        const next = { ...prev };
        for (const a of items) next[a.athlete_uuid] = a.name;
        return next;
      });
    } finally {
      setLoadingSearch(false);
    }
  }, []);

  // Initial load — fetch a small recent set so the search box has results immediately.
  useEffect(() => {
    void searchAthletes("");
  }, [searchAthletes]);

  // Debounce search-box input.
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      void searchAthletes(addAthleteQuery);
    }, 200);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [addAthleteQuery, searchAthletes]);

  // Handle URL-preloaded athletes — runs once, no longer gated on a full athlete list.
  useEffect(() => {
    if (urlPreloadDoneRef.current || !initialAthlete) return;
    urlPreloadDoneRef.current = true;
    const uuids = initialAthlete.split(",").map((s) => s.trim()).filter(Boolean);
    if (uuids.length > 0) {
      setTrackedUuids((prev) => Array.from(new Set([...prev, ...uuids])));
      if (initialCurrent && uuids.includes(initialCurrent)) {
        setCurrentUuid(initialCurrent);
      } else if (!currentUuid) {
        setCurrentUuid(uuids[0]!);
      }
    }
  }, [initialAthlete, initialCurrent]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (trackedUuids.length > 0) params.set("athlete", trackedUuids.join(","));
    if (currentUuid) params.set("current", currentUuid);
    const q = params.toString();
    const path = `/dashboard/athlete-tracking${q ? `?${q}` : ""}`;
    if (typeof window !== "undefined" && window.location.pathname + window.location.search !== path) {
      window.history.replaceState(null, "", path);
    }
  }, [trackedUuids, currentUuid]);

  const fetchReport = useCallback(async (athleteUuid: string) => {
    setLoadingReport(true);
    setReportError(null);
    try {
      const res = await fetch(
        `/api/dashboard/athlete-tracking/report?athleteUuid=${encodeURIComponent(athleteUuid)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setReportError(data.error ?? "Failed to load report");
        setReport(null);
        return;
      }
      setReport(data);
      setPageIndex(0);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Request failed");
      setReport(null);
    } finally {
      setLoadingReport(false);
    }
  }, []);

  useEffect(() => {
    if (currentUuid) {
      fetchReport(currentUuid);
      // Reset per-athlete state
      setDomainCompareDates({});
      setCompCache({});
      setCompLoadingKeys([]);
      setDomainViewMode({});
      setDomainCompareMode({});
      setAvailableDates({});
      setCompareReport(null);
      setCompareUuid(null);
    }
  }, [currentUuid, fetchReport]);

  // Cache athlete name once a report loads (used for tracked-athlete badge labels).
  useEffect(() => {
    if (report?.athlete) {
      setKnownNames((prev) => ({
        ...prev,
        [report.athlete.athleteUuid]: report.athlete.name,
      }));
    }
  }, [report]);

  useEffect(() => {
    const domain = report?.domains[pageIndex - 1];
    if (domain?.domainId === "athleticScreen") {
      setAthleticScreenSubIndex(0);
    }
  }, [report, pageIndex]);

  // Fetch available session dates when athlete changes
  useEffect(() => {
    if (!currentUuid) {
      setAvailableDates({});
      return;
    }
    setLoadingDates(true);
    fetch(`/api/dashboard/athlete-tracking/sessions?athleteUuid=${encodeURIComponent(currentUuid)}`)
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, string[]> = {};
        for (const { domainId, dates } of data.domains ?? []) {
          map[domainId] = dates;
        }
        setAvailableDates(map);
      })
      .catch(() => setAvailableDates({}))
      .finally(() => setLoadingDates(false));
  }, [currentUuid]);

  // Cross-athlete compare fetch
  useEffect(() => {
    const anyAthleteMode = Object.values(domainCompareMode).some((m) => m === "athlete");
    if (!anyAthleteMode || !compareUuid || compareUuid === currentUuid) {
      setCompareReport(null);
      return;
    }
    setLoadingCompare(true);
    setCompareReport(null);
    fetch(`/api/dashboard/athlete-tracking/report?athleteUuid=${encodeURIComponent(compareUuid)}`)
      .then(async (res) => {
        const data = await res.json();
        return res.ok ? data : null;
      })
      .then((data) => setCompareReport(data))
      .catch(() => setCompareReport(null))
      .finally(() => setLoadingCompare(false));
  }, [domainCompareMode, compareUuid, currentUuid]);

  // Fetch comparison reports for date-based comparisons
  useEffect(() => {
    if (!currentUuid) return;
    const toFetch: Array<{ domainId: string; date: string; key: string }> = [];
    for (const [domainId, dates] of Object.entries(domainCompareDates)) {
      for (const date of dates) {
        const key = `${domainId}|${date}`;
        if (compCache[key] === undefined && !compLoadingKeys.includes(key)) {
          toFetch.push({ domainId, date, key });
        }
      }
    }
    if (toFetch.length === 0) return;

    setCompLoadingKeys((prev) => [...prev, ...toFetch.map((f) => f.key)]);

    for (const { domainId, date, key } of toFetch) {
      const url = `/api/dashboard/athlete-tracking/report?athleteUuid=${encodeURIComponent(currentUuid)}&${encodeURIComponent(domainId + "Date")}=${encodeURIComponent(date)}`;
      fetch(url)
        .then(async (res) => {
          const data = await res.json();
          setCompCache((prev) => ({ ...prev, [key]: res.ok ? data : null }));
        })
        .catch(() => {
          setCompCache((prev) => ({ ...prev, [key]: null }));
        })
        .finally(() => {
          setCompLoadingKeys((prev) => prev.filter((k) => k !== key));
        });
    }
  }, [domainCompareDates, currentUuid, compCache, compLoadingKeys]);

  const selectAthlete = (uuid: string, name?: string) => {
    if (name) setKnownNames((prev) => ({ ...prev, [uuid]: name }));
    setTrackedUuids([uuid]);
    setCurrentUuid(uuid);
    setAddAthleteQuery("");
  };

  const addTracked = (uuid: string, name?: string) => {
    if (name) setKnownNames((prev) => ({ ...prev, [uuid]: name }));
    if (trackedUuids.includes(uuid)) return;
    setTrackedUuids((prev) => [...prev, uuid]);
    if (!currentUuid) setCurrentUuid(uuid);
  };

  const removeTracked = (uuid: string) => {
    setTrackedUuids((prev) => prev.filter((id) => id !== uuid));
    if (currentUuid === uuid) {
      const next = trackedUuids.filter((id) => id !== uuid);
      setCurrentUuid(next[0] ?? "");
    }
  };

  const addCompareDate = (domainId: string, date: string) => {
    setDomainCompareDates((prev) => {
      const existing = prev[domainId] ?? [];
      if (existing.includes(date) || existing.length >= 3) return prev;
      return { ...prev, [domainId]: [...existing, date] };
    });
  };

  const removeCompareDate = (domainId: string, date: string) => {
    setDomainCompareDates((prev) => {
      const existing = prev[domainId] ?? [];
      return { ...prev, [domainId]: existing.filter((d) => d !== date) };
    });
  };

  const { highlights, lowlights } =
    report && report.domains.length > 0
      ? getHighlightsAndLowlights(report.domains)
      : { highlights: [] as Array<{ domainLabel: string; domainId: string; metric: MetricWithPercentile }>, lowlights: [] as Array<{ domainLabel: string; domainId: string; metric: MetricWithPercentile }> };

  return (
    <Stack gap="lg">
      <div>
        <Title order={1} mb={4}>Athlete Tracking</Title>
        <Text c="dimmed">
          Select an athlete to view percentiles by domain and compare sessions over time.
        </Text>
      </div>

      <Card>
        <Text fw={600} size="sm" mb="xs">Select athlete</Text>
        <Group gap="xs" mb="sm" wrap="wrap" align="flex-start">
          <TextInput
            placeholder="Search by name…"
            value={addAthleteQuery}
            onChange={(e) => setAddAthleteQuery(e.target.value)}
            w={220}
            size="sm"
          />
          {loadingSearch && (
            <Text c="dimmed" size="sm" style={{ alignSelf: "center" }}>Searching…</Text>
          )}
          {!loadingSearch && searchResults.length > 0 && (
            <Group gap={4} wrap="wrap">
              {searchResults.slice(0, 20).map((a) => (
                <button
                  key={a.athlete_uuid}
                  type="button"
                  className="btn-ghost"
                  style={{ fontSize: "13px" }}
                  onClick={() => selectAthlete(a.athlete_uuid, a.name)}
                >
                  {a.name}
                </button>
              ))}
            </Group>
          )}
        </Group>

        <Text fw={600} size="sm" mb={6}>Selected athlete</Text>
        {trackedUuids.length === 0 ? (
          <Text c="dimmed" size="sm">Search for an athlete above to get started.</Text>
        ) : (
          <Group gap={6} wrap="wrap">
            {trackedUuids.map((uuid) => {
              const name = knownNames[uuid] ?? uuid.slice(0, 8);
              const isCurrent = currentUuid === uuid;
              return (
                <Badge
                  key={uuid}
                  variant={isCurrent ? "light" : "outline"}
                  color={isCurrent ? "octaneBlue" : "gray"}
                  size="lg"
                  style={{ cursor: "pointer" }}
                  onClick={() => setCurrentUuid(uuid)}
                  rightSection={
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeTracked(uuid); }}
                      style={{ all: "unset", cursor: "pointer", lineHeight: 1, marginLeft: 2 }}
                      aria-label={`Remove ${name}`}
                    >
                      ×
                    </button>
                  }
                >
                  {name}
                </Badge>
              );
            })}
          </Group>
        )}
      </Card>

      {!currentUuid && (
        <p className="text-muted">
          <Link href="/dashboard">Back to dashboard</Link>
        </p>
      )}

      {currentUuid && (
        <>
          {loadingReport && (
            <div className="card" style={{ marginBottom: "1rem" }}>
              <p className="text-muted">Loading report…</p>
            </div>
          )}
          {reportError && (
            <div className="card" style={{ marginBottom: "1rem", borderColor: "var(--accent-secondary)" }}>
              <p className="text-danger">{reportError}</p>
            </div>
          )}
          {report && !loadingReport && (
            <>
              <div style={{ marginBottom: "1rem" }}>
                <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.1rem" }}>
                  {report.athlete.name}
                </h2>

                {/* Domain tabs */}
                {(() => {
                  const tabValue =
                    pageIndex === 0
                      ? "__highlights__"
                      : (report.domains[pageIndex - 1]?.domainId ?? "__highlights__");
                  return (
                    <Tabs
                      value={tabValue}
                      onChange={(v) => {
                        if (!v || v === "__highlights__") { setPageIndex(0); return; }
                        const idx = report.domains.findIndex((d) => d.domainId === v);
                        if (idx !== -1) setPageIndex(idx + 1);
                      }}
                      variant="pills"
                      keepMounted={false}
                    >
                      <TabsList mb="md" style={{ flexWrap: "wrap", gap: 4 }}>
                        <TabsTab value="__highlights__">Highlights vs Lowlights</TabsTab>
                        {report.domains.map((d) => (
                          <TabsTab key={d.domainId} value={d.domainId}>
                            {d.sessionDate ? `${d.label} (${d.sessionDate})` : d.label}
                          </TabsTab>
                        ))}
                      </TabsList>
                    </Tabs>
                  );
                })()}
              </div>

              {pageIndex === 0 && (
                <div className="card" style={{ marginBottom: "1.5rem" }}>
                  <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>
                    Highlights vs Lowlights
                  </h3>
                  {(highlights.length === 0 && lowlights.length === 0) ? (
                    <p className="text-muted">No domain data for this athlete.</p>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
                      <div>
                        <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.9rem", color: "var(--accent)" }}>Highlights</h4>
                        <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                          {highlights.map(({ domainLabel, domainId, metric }, i) => (
                            <li key={`high-${i}-${domainLabel}-${metric.name}`} style={{ marginBottom: "0.35rem" }}>
                              {formatMetricDisplayName(metric.name, metric.category, domainId)} <span className="text-muted">({domainLabel})</span>{" "}
                              <span style={getPercentileStyle(metric.percentile)}>{Math.round(metric.percentile ?? 0)}th %ile</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.9rem", color: "var(--accent-secondary)" }}>Lowlights</h4>
                        <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                          {lowlights.map(({ domainLabel, domainId, metric }, i) => (
                            <li key={`low-${i}-${domainLabel}-${metric.name}`} style={{ marginBottom: "0.35rem" }}>
                              {formatMetricDisplayName(metric.name, metric.category, domainId)} <span className="text-muted">({domainLabel})</span>{" "}
                              <span style={getPercentileStyle(metric.percentile)}>{Math.round(metric.percentile ?? 0)}th %ile</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {pageIndex >= 1 && report.domains[pageIndex - 1] && (() => {
                const domain = report.domains[pageIndex - 1]!;
                const compareDates = domainCompareDates[domain.domainId] ?? [];
                const viewMode = domainViewMode[domain.domainId] ?? "compare";
                const domainMode = domainCompareMode[domain.domainId] ?? "none";
                const toggleDomainMode = (mode: "date" | "athlete") => {
                  setDomainCompareMode((prev) => ({
                    ...prev,
                    [domain.domainId]: prev[domain.domainId] === mode ? "none" : mode,
                  }));
                };

                // Build radar series (multi-date or cross-athlete)
                const radarMetrics = getRadarMetricsForDomain(domain.metrics, domain.domainId);
                const series: RadarDataSeries[] = [
                  {
                    name: domain.sessionDate ?? "Latest",
                    data: metricsToRadarData(radarMetrics, domain.domainId),
                    color: SERIES_COLORS[0]!,
                  },
                ];
                if (domainMode === "date") {
                  compareDates.forEach((date, i) => {
                    const key = `${domain.domainId}|${date}`;
                    const cached = compCache[key];
                    if (cached) {
                      const compDomain = cached.domains.find((d) => d.domainId === domain.domainId);
                      if (compDomain) {
                        const compRadar = getRadarMetricsForDomain(compDomain.metrics, domain.domainId);
                        series.push({
                          name: date,
                          data: metricsToRadarData(compRadar, domain.domainId),
                          color: SERIES_COLORS[i + 1] ?? SERIES_COLORS[SERIES_COLORS.length - 1]!,
                        });
                      }
                    }
                  });
                } else if (domainMode === "athlete" && compareReport) {
                  const compareDomain = compareReport.domains.find((d) => d.domainId === domain.domainId);
                  if (compareDomain) {
                    const compRadar = getRadarMetricsForDomain(compareDomain.metrics, domain.domainId);
                    series.push({
                      name: compareReport.athlete.name,
                      data: metricsToRadarData(compRadar, domain.domainId),
                      color: SERIES_COLORS[1]!,
                    });
                  }
                }

                // Session date comparison panel (shown for date mode)
                const availForDomain = availableDates[domain.domainId] ?? [];
                const primaryDate = domain.sessionDate;
                const usedDates = new Set([primaryDate, ...compareDates].filter(Boolean));
                const remainingDates = availForDomain.filter((d) => !usedDates.has(d));

                // Timeline: build date-ordered rows of key metrics
                const timelineKeys = getTimelineMetricKeys(domain.domainId);
                const timelineDates: string[] = [];
                if (primaryDate) timelineDates.push(primaryDate);
                for (const d of compareDates) {
                  if (!timelineDates.includes(d)) timelineDates.push(d);
                }
                // Sort by date descending
                timelineDates.sort((a, b) => b.localeCompare(a));

                const getMetricValueFromDomain = (d: DomainWithMetrics | undefined, key: string): string => {
                  if (!d) return "—";
                  const metric = getMetricByKey(d.metrics, key);
                  if (!metric) return "—";
                  const { valuePart, unitPart } = formatMetricValueParts(metric);
                  return valuePart === "—" ? "—" : `${valuePart}${unitPart}`;
                };

                const getDomainForDate = (date: string): DomainWithMetrics | undefined => {
                  if (date === primaryDate) return domain;
                  const key = `${domain.domainId}|${date}`;
                  const cached = compCache[key];
                  if (!cached) return undefined;
                  return cached.domains.find((d) => d.domainId === domain.domainId);
                };

                // Build comparison domains for table rows (date or athlete comparison)
                const compDomains: Array<{ label: string; domain: DomainWithMetrics }> = [];
                if (domainMode === "date") {
                  for (const date of compareDates) {
                    const cached = compCache[`${domain.domainId}|${date}`];
                    const cd = cached?.domains.find((d) => d.domainId === domain.domainId);
                    if (cd) compDomains.push({ label: date, domain: cd });
                  }
                } else if (domainMode === "athlete" && compareReport) {
                  const cd = compareReport.domains.find((d) => d.domainId === domain.domainId);
                  if (cd) compDomains.push({ label: compareReport.athlete.name, domain: cd });
                }

                // Compare mode buttons (rendered at the top of every domain page)
                const compareModeButtons = (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{
                        fontSize: "13px",
                        padding: "7px 16px",
                        borderRadius: 6,
                        border: `1px solid ${domainMode === "date" ? "var(--accent)" : "var(--border)"}`,
                        background: domainMode === "date" ? "var(--accent-muted)" : "transparent",
                        color: domainMode === "date" ? "var(--accent)" : "var(--text-secondary)",
                        fontWeight: 500,
                      }}
                      onClick={() => toggleDomainMode("date")}
                    >
                      Compare Sessions
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{
                        fontSize: "13px",
                        padding: "7px 16px",
                        borderRadius: 6,
                        border: `1px solid ${domainMode === "athlete" ? "var(--accent)" : "var(--border)"}`,
                        background: domainMode === "athlete" ? "var(--accent-muted)" : "transparent",
                        color: domainMode === "athlete" ? "var(--accent)" : "var(--text-secondary)",
                        fontWeight: 500,
                      }}
                      onClick={() => toggleDomainMode("athlete")}
                    >
                      Compare Other Athletes
                    </button>
                    {domainMode === "athlete" && (
                      <>
                        <Select
                          value={compareUuid ?? ""}
                          onChange={(value) => setCompareUuid(value || null)}
                          disabled={loadingCompare}
                          data={[
                            { value: "", label: "— None —" },
                            ...searchResults
                              .filter((a) => a.athlete_uuid !== currentUuid)
                              .map((a) => ({ value: a.athlete_uuid, label: a.name })),
                          ]}
                          clearable
                          w={200}
                          size="xs"
                        />
                        {loadingCompare && <Text size="sm" c="dimmed">Loading…</Text>}
                      </>
                    )}
                  </div>
                );

                if (domain.domainId === "athleticScreen") {
                  const ATHLETIC_SCREEN_MOVEMENT_ORDER = ["DJ", "PPU", "CMJ", "SLV"] as const;
                  const ATHLETIC_SCREEN_VARIABLE_ORDER = [
                    "JH", "PP", "Work (AUC)", "Kurtosis", "Max RPD", "Time to Max RPD", "RSI", "CT",
                  ] as const;
                  const ATHLETIC_SCREEN_VARIABLE_DESCRIPTIONS: Record<string, string> = {
                    JH: "Jump height; higher generally indicates better explosive output.",
                    PP: "Peak power; maximum power generated during the movement.",
                    "Work (AUC)": "Total mechanical energy produced during the movement.",
                    Kurtosis: "Shape descriptor of the power-time curve.",
                    "Max RPD": "Peak slope of the power-time curve from 10–90% of peak power.",
                    "Time to Max RPD": "Time elapsed from movement start to peak rate of power development.",
                    RSI: "Reactive Strength Index; jump outcome relative to contact time.",
                    CT: "Contact time during the drop jump.",
                  };

                  type AthleticVariableDetail = {
                    formula: string;
                    what: string;
                    benchmarks: string;
                    characterizes: string;
                  };
                  const ATHLETIC_SCREEN_VARIABLE_DETAIL: Partial<Record<string, AthleticVariableDetail>> = {
                    "Work (AUC)": {
                      formula: "Time integral of the power curve (Joules) — area under the power-time trace.",
                      what: "Captures both how much power was produced and how long it was sustained. Two athletes can share the same peak power but differ wildly in AUC if one sustains output and the other spikes then drops. Higher AUC means more total mechanical energy delivered to the system.",
                      benchmarks: "Values are movement-specific and not directly comparable across DJ, CMJ, PPU, and SLV. Rising AUC across sessions for the same movement indicates improved power endurance or better force application timing. In the DJ the contact phase is brief so AUC reflects explosive efficiency under constraint; in the CMJ the longer propulsion window typically yields higher AUC.",
                      characterizes: "Total energy output quality — the interaction of amplitude and duration. Pair with Max RPD: high RPD + high AUC = explosive and sustained; high RPD + low AUC = explosive but brief. Low AUC relative to PP suggests the athlete peaks early and decays quickly.",
                    },
                    Kurtosis: {
                      formula: "Fourth standardized moment of the power-time distribution. Measures the 'peakedness' vs flatness of the curve.",
                      what: "High kurtosis → the power curve has a sharp, narrow spike; power is concentrated at one specific moment. Low kurtosis → power is spread more evenly across the movement. Neither is inherently better — it depends on the movement and what you are training.",
                      benchmarks: "DJ and SLV tend to naturally produce higher kurtosis due to the short, reactive nature of the effort. CMJ typically has lower kurtosis as the longer amortization phase spreads power across more time. PPU kurtosis reflects upper-body explosive strategy. Sudden unexplained drops in kurtosis for a given movement may indicate fatigue-driven changes in motor strategy.",
                      characterizes: "The shape and concentration of force application. When paired with Max RPD it reveals whether explosive capacity is channeled into a single high-intensity spike (DJ/sprint-like) or distributed across a broader propulsion window (CMJ/strength-dominant). Useful for profiling sport-specific force strategies and detecting session-to-session motor pattern shifts.",
                    },
                    "Max RPD": {
                      formula: "Peak slope of the power-time curve, calculated between 10% and 90% of peak power (W/s).",
                      what: "Measures how fast the athlete ramps up power — the steepness of the rising edge of the power curve. It is primarily a neural quality: motor unit recruitment speed, synchronization, and rate coding. High peak power with low RPD means the athlete gets there eventually but too slowly for reactive sport demands.",
                      benchmarks: "RPD values differ substantially across movements — DJ and SLV produce the steepest ramps due to the reactive constraint; CMJ allows a slower build; PPU reflects upper-body neural drive. Always compare within the same movement across sessions. Consistent improvement in DJ Max RPD is one of the strongest indicators of plyometric development.",
                      characterizes: "Neural drive and explosive onset. RPD ≈ 'How fast can you turn power on?' Directly relevant to DJ and SLV where the ground contact window leaves no time for a slow ramp. An athlete can have elite PP and AUC but underperform in reactive tasks if RPD is low.",
                    },
                    "Time to Max RPD": {
                      formula: "Milliseconds from movement initiation to the instant of peak rate of power development.",
                      what: "Shorter time means the explosive peak arrives sooner. This reflects how quickly the nervous system can coordinate peak motor unit recruitment. It is particularly meaningful in the DJ and SLV where the entire contact phase may last only 150–250 ms.",
                      benchmarks: "In the DJ, Time to Max RPD must be very short to occur within the contact window — values that exceed contact time indicate the athlete is not producing their explosive peak on the ground at all. In CMJ and PPU, somewhat longer times are expected and appropriate. Shorter Time to Max RPD combined with high Max RPD = elite explosive profile.",
                      characterizes: "The accessibility and immediacy of explosive output. Complements Max RPD: the RPD value is the ceiling, Time to Max RPD is how fast you reach it. An athlete with high RPD but long Time to Max RPD has the capacity but cannot access it reactively — a gap that shows up in DJ performance and sport-specific acceleration tasks.",
                    },
                    RSI: {
                      formula: "RSI = Jump Height ÷ Contact Time. Reported on a 0–5 scale (values are multiplied by 2 to amplify resolution).",
                      what: "Combines jump outcome with ground contact efficiency into a single ratio. Quantifies the stretch-shortening cycle (SSC) — the ability to store elastic energy on impact and release it as propulsive force. Higher RSI means more output achieved in less time on the ground. Because values are scaled ×2, the displayed number is twice the raw ratio.",
                      benchmarks: "On this scaled 0–5 system: ~3.0 represents a solid competitive athlete baseline; values above 4.0 are typically elite-level reactive capacity; values below 2.0 may indicate SSC deficits or elevated fatigue. RSI applies primarily to DJ and SLV where a reactive constraint is present. CMJ and PPU RSI should be interpreted with caution as the movement is not reactive.",
                      characterizes: "Tendon stiffness, elastic energy utilization, and reactive neuromuscular efficiency. RSI is distinct from peak power — an athlete can be very powerful (high PP, high AUC) but have poor RSI if they are slow off the ground. It is the most direct measure of plyometric and reactive capacity in this screen, and often the most sensitive to fatigue.",
                    },
                  };
                  const ATHLETIC_SCREEN_TABLE_CATEGORY_ORDER = [
                    "DJ", "CMJ", "PPU", "SLV_Left", "SLV_Right",
                  ] as const;
                  const ATHLETIC_SCREEN_CATEGORY_LABELS: Record<string, string> = {
                    CMJ: "CMJ", DJ: "DJ", PPU: "PPU", SLV_Left: "SLV Left", SLV_Right: "SLV Right",
                  };
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

                  // Build radar series (primary + comparison dates)
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

                  // Build comparison metric lookup maps for table
                  const compMetricMaps = compDomains.map(({ label, domain: cd }) => {
                    const map = new Map<string, MetricWithPercentile>();
                    for (const m of cd.metrics) map.set(`${m.category}|${m.name}`, m);
                    return { label, map };
                  });

                  return (
                    <>
                      {compareModeButtons}
                      {/* Session comparison panel */}
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

                if (domain.domainId === "proteus") {
                  const movements = Array.from(new Set(domain.metrics.map((m) => m.category)));

                  // Human-readable label per Proteus metric name
                  const proteusMetricLabel = (name: string): string => {
                    const MAP: Record<string, string> = {
                      Power_high: "Peak Power",
                      Velocity_high: "Peak Velocity",
                      Acceleration_high: "Peak Acceleration",
                      Power_mean: "Average Power",
                      Velocity_mean: "Average Velocity",
                      Acceleration_mean: "Average Acceleration",
                    };
                    return MAP[name] ?? name.replace(/_high$/i, " (Peak)").replace(/_mean$/i, " (Avg)");
                  };

                  // One 6-point series per date (all 6 metrics as individual radar axes)
                  const buildProteusSeries = (metrics: MetricWithPercentile[], seriesName: string, color: string): RadarDataSeries => ({
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
                  });

                  return (
                    <>
                      {compareModeButtons}
                      {/* Session comparison panel */}
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

                        // One series per date, each with 6 points (Peak + Average for Power/Velocity/Acceleration)
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

                        // Comparison table data
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
                            </div>
                          </div>
                        );
                      })}
                    </>
                  );
                }

                // Generic domain rendering (pitching, hitting, mobility, armAction)
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
                            // Build chart data sorted chronologically (oldest → newest)
                            const chartDates = [...timelineDates].sort((a, b) => a.localeCompare(b));
                            const chartData = chartDates.map((date) => {
                              const d = getDomainForDate(date);
                              const raw = getMetricValueFromDomain(d, key);
                              const num = raw === "—" ? null : parseFloat(raw);
                              return { date, value: Number.isFinite(num) ? num : null };
                            });
                            // Extract unit from primary domain metric
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
                        {timelineDates.some((d) => d !== primaryDate && !compCache[`${domain.domainId}|${d}`]) && (
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
                          return (
                            <div key={section.id} className="card" style={{ marginBottom: "1rem" }}>
                              {section.title ? (
                                <h3 style={{ margin: "0 0 0.35rem", fontSize: "1rem" }}>{section.title}</h3>
                              ) : null}
                              <p
                                className="text-muted"
                                style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", lineHeight: 1.45 }}
                              >
                                {section.description}
                              </p>
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
                                            <strong
                                              style={
                                                cell.key.endsWith("|GAIN_OR_LOSS")
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
                                                    : undefined
                                              }
                                            >
                                              {cell.valuePart}
                                            </strong>
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
                      </div>
                    )}
                  </>
                );
              })()}
            </>
          )}

          <Text size="sm" c="dimmed" mt="md">
            <Link href="/dashboard">Back to dashboard</Link>
          </Text>
        </>
      )}
    </Stack>
  );
}

export function AthleteTrackingContent() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <AthleteTrackingContentInner />
    </Suspense>
  );
}
