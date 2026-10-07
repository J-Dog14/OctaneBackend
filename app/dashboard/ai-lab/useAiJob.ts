"use client";

import { useCallback, useRef, useState } from "react";
import type { Values } from "./types";

export type Artifact = { path: string; label: string };

const ARTIFACT_RE = /^\[ARTIFACT\] (.+?)::(.*)$/;
const RESULT_RE = /^\[RESULT\] (.*)$/;

/**
 * Start an AI Lab action and stream its output. Reuses the UAIS stream/kill
 * routes — AI Lab jobs live in the same job table.
 */
export function useAiJob(onFinished?: () => void) {
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const jobIdRef = useRef<string | null>(null);

  const run = useCallback(
    async (actionId: string, params: Values, actionLabel: string) => {
      setOutput("");
      setArtifacts([]);
      setResult(null);
      setError(null);
      setExitCode(null);
      setLabel(actionLabel);
      setRunning(true);
      try {
        const res = await fetch("/api/dashboard/ai-lab/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actionId, params }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
        const jobId: string = data.jobId;
        jobIdRef.current = jobId;

        const sres = await fetch(`/api/dashboard/uais/stream?jobId=${encodeURIComponent(jobId)}`);
        if (!sres.ok || !sres.body) throw new Error("Could not attach to job output");
        const reader = sres.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        const seen = new Set<string>();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          setOutput((o) => o + chunk);
          pending += chunk;
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? "";
          for (const line of lines) {
            const a = ARTIFACT_RE.exec(line);
            if (a && !seen.has(a[1])) {
              seen.add(a[1]);
              setArtifacts((xs) => [...xs, { path: a[1], label: a[2] || a[1] }]);
            }
            const r = RESULT_RE.exec(line);
            if (r) {
              try {
                setResult(JSON.parse(r[1]));
              } catch {
                /* partial */
              }
            }
            const x = /\[Process exited with code (\d+)\]/.exec(line);
            if (x) setExitCode(Number(x[1]));
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
        jobIdRef.current = null;
        onFinished?.();
      }
    },
    [onFinished]
  );

  const kill = useCallback(async () => {
    if (!jobIdRef.current) return;
    await fetch("/api/dashboard/uais/kill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: jobIdRef.current }),
    });
  }, []);

  return { run, kill, output, running, label, artifacts, result, error, exitCode };
}

export type AiJob = ReturnType<typeof useAiJob>;
