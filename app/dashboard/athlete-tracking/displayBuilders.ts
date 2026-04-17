import type { MetricWithPercentile, PitchingSectionMetricItem, PitchingSectionDerivedItem, PitchingDisplayCell, HittingSectionMetricItem } from "./types";
import { formatValueWithUnit } from "@/lib/athlete-tracking/displayNames";
import { getMetricByKey, formatMetricValueParts } from "./domainHelpers";

export function buildPitchingDisplayCells(
  metrics: MetricWithPercentile[],
  items: Array<PitchingSectionMetricItem | PitchingSectionDerivedItem>
): PitchingDisplayCell[] {
  return items.map((item) => {
    if (item.kind === "metric") {
      const metric = getMetricByKey(metrics, item.key);
      if (!metric) {
        return { key: item.key, label: item.label, valuePart: "—", unitPart: "", percentile: null };
      }
      // GAIN_OR_LOSS: show "GAIN" or "LOSS" text, never a raw number
      if (
        item.key === "HIP_SHOULDER_PROGRESS|GAIN_OR_LOSS" ||
        item.key === "ABDUCTION_PROGRESS|GAIN_OR_LOSS"
      ) {
        return {
          key: item.key,
          label: item.label,
          valuePart: metric.value === 1 ? "GAIN" : "LOSS",
          unitPart: "",
          percentile: null,
        };
      }
      // Diff FP to Peak / Time to Peak: N/A when LOSS
      if (
        item.key === "HIP_SHOULDER_PROGRESS|AMOUNT_TO_PEAK" ||
        item.key === "ABDUCTION_PROGRESS|AMOUNT_TO_PEAK" ||
        item.key === "HIP_SHOULDER_PROGRESS|PEAK_AFTER_FOOTSTRIKE_MS" ||
        item.key === "ABDUCTION_PROGRESS|PEAK_AFTER_FOOTSTRIKE_MS"
      ) {
        const gainKey = item.key.startsWith("HIP_SHOULDER_PROGRESS")
          ? "HIP_SHOULDER_PROGRESS|GAIN_OR_LOSS"
          : "ABDUCTION_PROGRESS|GAIN_OR_LOSS";
        const gainMetric = getMetricByKey(metrics, gainKey);
        if (gainMetric?.value !== 1) {
          return { key: item.key, label: item.label, valuePart: "N/A", unitPart: "", percentile: null };
        }
      }
      // Time to Peak: force ms unit
      if (
        item.key === "HIP_SHOULDER_PROGRESS|PEAK_AFTER_FOOTSTRIKE_MS" ||
        item.key === "ABDUCTION_PROGRESS|PEAK_AFTER_FOOTSTRIKE_MS"
      ) {
        const { valuePart } = formatMetricValueParts(metric);
        return { key: item.key, label: item.label, valuePart, unitPart: " ms", percentile: metric.percentile };
      }
      const { valuePart, unitPart } = formatMetricValueParts(metric);
      return { key: item.key, label: item.label, valuePart, unitPart, percentile: metric.percentile };
    }

    if (item.derivedId === "MAX_HSS") {
      const footPlant = getMetricByKey(metrics, "HIP_SHOULDER_SEPARATION|FOOT_PLANT")?.value;
      const amountToPeak = getMetricByKey(metrics, "HIP_SHOULDER_PROGRESS|AMOUNT_TO_PEAK")?.value;
      const maxHss =
        footPlant != null && Number.isFinite(footPlant)
          ? footPlant + Math.max(amountToPeak ?? 0, 0)
          : null;
      const { valuePart, unitPart } = formatValueWithUnit(maxHss, "DEGREES");
      return { key: "DERIVED|MAX_HSS", label: item.label, valuePart, unitPart, percentile: null };
    }

    const armTimingSource = getMetricByKey(metrics, "SHOULDER_ER|FOOT_PLANT")?.value;
    let armTimingFlag = "—";
    if (armTimingSource != null && Number.isFinite(armTimingSource)) {
      if (armTimingSource < 33) armTimingFlag = "LATE";
      else if (armTimingSource > 77) armTimingFlag = "EARLY";
      else armTimingFlag = "ON_TIME";
    }
    return { key: "DERIVED|ARM_TIMING_FLAG", label: item.label, valuePart: armTimingFlag, unitPart: "", percentile: null };
  });
}

export function buildHittingDisplayCells(
  metrics: MetricWithPercentile[],
  items: HittingSectionMetricItem[]
): PitchingDisplayCell[] {
  return items.map((item) => {
    const metric = getMetricByKey(metrics, item.key);
    if (!metric) {
      return { key: item.key, label: item.label, valuePart: "—", unitPart: "", percentile: null };
    }
    const { valuePart, unitPart } = formatMetricValueParts(metric);
    return { key: item.key, label: item.label, valuePart, unitPart, percentile: metric.percentile };
  });
}
