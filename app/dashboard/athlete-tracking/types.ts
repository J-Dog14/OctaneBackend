export type AthleteItem = {
  athlete_uuid: string;
  name: string;
};

export type MetricWithPercentile = {
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
  mobilityOptimalRange?: string | null;
  mobilityRangeScore?: number | null;
};

export type DomainWithMetrics = {
  domainId: string;
  label: string;
  metrics: MetricWithPercentile[];
  sessionDate?: string | null;
};

export type AthleteTrackingReport = {
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

export type PitchingSectionMetricItem = { kind: "metric"; key: string; label: string };
export type PitchingSectionDerivedItem = { kind: "derived"; derivedId: string; label: string };
export type PitchingSection = {
  id: string;
  title?: string;
  description: string;
  items: Array<PitchingSectionMetricItem | PitchingSectionDerivedItem>;
  insightKeys?: string[];
};
export type PitchingDisplayCell = {
  key: string;
  label: string;
  valuePart: string;
  unitPart: string;
  percentile: number | null;
};
export type HittingSectionMetricItem = { key: string; label: string };
export type HittingSection = {
  id: string;
  title: string;
  description: string;
  items: HittingSectionMetricItem[];
};

export type AthleticVariableDetail = {
  formula: string;
  what: string;
  benchmarks: string;
  characterizes: string;
};

export type MobilityGroupMetric = MetricWithPercentile & { mobilityMetricKind: "GROUP" };
export type MobilityComponentMetric = MetricWithPercentile & { mobilityMetricKind: "COMPONENT" };
