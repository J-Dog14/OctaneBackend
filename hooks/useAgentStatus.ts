"use client";

import { useEffect, useState } from "react";

export function useAgentStatus() {
  const [agentOnline, setAgentOnline] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [r2Available, setR2Available] = useState<boolean | null>(null);

  // Probe R2 availability
  useEffect(() => {
    fetch("/api/dashboard/uais/upload", { method: "HEAD" })
      .then((r) => setR2Available(r.status !== 503))
      .catch(() => setR2Available(false));
  }, []);

  // Poll agent status every 10 seconds
  useEffect(() => {
    const check = () => {
      fetch("/api/sync/agent-status")
        .then((r) => r.json())
        .then((d: { online?: boolean }) => setAgentOnline(d.online ?? false))
        .catch(() => setAgentOnline(false));
    };
    check();
    const interval = setInterval(check, 10_000);
    return () => clearInterval(interval);
  }, []);

  return { agentOnline, syncStatus, setSyncStatus, r2Available };
}
