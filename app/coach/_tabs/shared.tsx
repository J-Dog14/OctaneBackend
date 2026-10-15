"use client";

import useSWR from "swr";
import { Alert, Loader } from "@mantine/core";
import type { AthleteTrackingReport, DomainWithMetrics } from "@/app/dashboard/athlete-tracking/types";
import { swrOpts, trackingKey } from "../_components/fetcher";

export function useTracking(athleteUuid: string) {
  return useSWR<AthleteTrackingReport>(trackingKey(athleteUuid), swrOpts);
}

export function pickDomains(report: AthleteTrackingReport | undefined, ids: string[]): DomainWithMetrics[] {
  if (!report) return [];
  return ids.map((id) => report.domains.find((d) => d.domainId === id)).filter((d): d is DomainWithMetrics => !!d);
}

export function LoadState({ isLoading, error }: { isLoading: boolean; error?: Error }) {
  if (isLoading) return <Loader size="sm" />;
  if (error) return <Alert color="red">{error.message}</Alert>;
  return null;
}

export function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="card-head" style={{ marginBottom: "0.75rem" }}>
      <h2 style={{ margin: 0, fontSize: "1rem" }}>{title}</h2>
      {sub && <span className="card-sub">{sub}</span>}
    </div>
  );
}

/** Stat tile in the app's .stat style. Neutral (accent bar) unless a tone is given. */
export function StatTile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "up" | "down" | "flat" }) {
  return (
    <div className={`stat${tone ? ` ${tone}` : ""}`} style={{ minWidth: 160 }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: "1.35rem" }}>{value}</div>
      {sub != null && <div className="stat-delta" style={{ fontSize: "0.72rem" }}>{sub}</div>}
    </div>
  );
}
