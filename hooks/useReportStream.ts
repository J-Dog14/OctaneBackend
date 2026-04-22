"use client";

import { useCallback, useRef, useState } from "react";
import { REPORT_TYPES, type AthleteOption, type ReportTypeId } from "@/app/dashboard/reports/constants";

const REPORT_LINE_REGEX = /\[REPORT\] ([^:]+)::([^\s]+)/g;

export function useReportStream() {
  const [output, setOutput] = useState("");
  const [reportLinks, setReportLinks] = useState<{ filename: string; url: string }[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobIdRef = useRef<string | null>(null);

  const cancelReport = useCallback(async () => {
    if (!jobIdRef.current) return;
    await fetch("/api/dashboard/uais/kill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: jobIdRef.current }),
    }).catch(() => undefined);
  }, []);

  const generateReport = useCallback(
    async (athleteSelected: AthleteOption | null, reportType: ReportTypeId, sessionDate?: string | null) => {
      if (!athleteSelected) {
        setError("Select an athlete first.");
        return;
      }
      setError(null);
      setOutput("");
      setReportLinks([]);
      setStreaming(true);

      try {
        const res = await fetch("/api/dashboard/uais/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runnerId: reportType,
            athleteUuid: athleteSelected.athlete_uuid,
            reportOnly: true,
            sessionDate: sessionDate ?? undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed to start report");
          setStreaming(false);
          return;
        }
        const jobId = data.jobId;
        if (!jobId) {
          setError("No job ID returned");
          setStreaming(false);
          return;
        }
        jobIdRef.current = jobId;

        const label = REPORT_TYPES.find((r) => r.id === reportType)?.label ?? reportType;
        setOutput(`——— ${label} Report ———\n`);

        const sres = await fetch(`/api/dashboard/uais/stream?jobId=${encodeURIComponent(jobId)}`);
        if (!sres.ok) {
          const errData = await sres.json().catch(() => ({}));
          setOutput((prev) => prev + `\n[Error] ${errData.error ?? sres.statusText}\n`);
          setStreaming(false);
          return;
        }
        const reader = sres.body?.getReader();
        if (!reader) {
          setOutput((prev) => prev + "\n[Error] No stream body\n");
          setStreaming(false);
          return;
        }
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          let reportMatch: RegExpExecArray | null;
          REPORT_LINE_REGEX.lastIndex = 0;
          const newLinks: { filename: string; url: string }[] = [];
          while ((reportMatch = REPORT_LINE_REGEX.exec(chunk)) !== null) {
            newLinks.push({ filename: reportMatch[1], url: reportMatch[2] });
          }
          if (newLinks.length > 0) setReportLinks((prev) => [...prev, ...newLinks]);
          setOutput((prev) => prev + chunk);
        }
      } catch (e) {
        setOutput(
          (prev) => prev + `\n[Error] ${e instanceof Error ? e.message : "Unknown error"}\n`
        );
      } finally {
        jobIdRef.current = null;
        setStreaming(false);
      }
    },
    []
  );

  return { output, reportLinks, streaming, error, cancelReport, generateReport };
}
