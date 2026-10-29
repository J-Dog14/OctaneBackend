"use client";

import { Alert } from "@mantine/core";
import type { CoachAthleteSummary } from "@/lib/coach/summary";
import { ClientProfile } from "../_components/clientHub/ClientProfile";

/** An active programmer's client record: the same page as /coach/clients/:id, inside the athlete view. */
export function ProgramManagementTab({ summary }: { summary: CoachAthleteSummary }) {
  if (!summary.hubClient) return <Alert color="gray">This athlete isn&apos;t in the Client Hub.</Alert>;
  return <ClientProfile clientId={summary.hubClient.id} embedded />;
}
