"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { AdminGuard } from "@/app/dashboard/AdminGuard";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type AthleteItem = {
  athlete_uuid: string;
  name: string;
  pitching_session_count: number;
  athletic_screen_session_count: number;
  proteus_session_count: number;
};

const PAYLOAD_TYPES = [
  { id: "report", label: "Report (all tables)", api: "/api/dashboard/payloads/report" },
  { id: "pitching", label: "Pitching", api: "/api/dashboard/payloads/pitching" },
  { id: "hitting", label: "Hitting", api: "/api/dashboard/payloads/hitting" },
  { id: "mobility", label: "Mobility", api: "/api/dashboard/payloads/mobility" },
  { id: "athletic-screen", label: "Athletic Screen", api: "/api/dashboard/payloads/athletic-screen" },
  { id: "arm-action", label: "Arm Action", api: "/api/dashboard/payloads/arm-action" },
  { id: "proteus-hitters", label: "Proteus (Hitters)", api: "/api/dashboard/payloads/proteus-hitters" },
  { id: "proteus-pitchers", label: "Proteus (Pitchers)", api: "/api/dashboard/payloads/proteus-pitchers" },
] as const;

type PayloadTypeId = (typeof PAYLOAD_TYPES)[number]["id"];
const SINGLE_ATHLETE_PAYLOAD_IDS: PayloadTypeId[] = [
  "pitching",
  "hitting",
  "mobility",
  "athletic-screen",
  "arm-action",
  "proteus-hitters",
  "proteus-pitchers",
];

type OctaneLookupUser = {
  uuid: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
  image: string | null;
};

function SendPayloadContent() {
  const searchParams = useSearchParams();
  const preselectedUuid = searchParams.get("athlete") ?? "";

  const [athletes, setAthletes] = useState<AthleteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [payloadType, setPayloadType] = useState<PayloadTypeId>("report");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; data?: unknown } | null>(null);

  const [octaneLookupEmail, setOctaneLookupEmail] = useState("");
  const [octaneLookupLoading, setOctaneLookupLoading] = useState(false);
  const [octaneLookupResult, setOctaneLookupResult] = useState<
    { ok: true; user: OctaneLookupUser } | { ok: false; error: string } | null
  >(null);

  const loadAthletes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/athletes?limit=200");
      const data = await res.json();
      if (data.items) setAthletes(data.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAthletes();
  }, [loadAthletes]);

  useEffect(() => {
    if (preselectedUuid && athletes.length > 0) {
      setSelectedIds((prev) => new Set(prev).add(preselectedUuid));
    }
  }, [preselectedUuid, athletes.length]);

  const toggleAthlete = (uuid: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(athletes.map((a) => a.athlete_uuid)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const runOctaneLookup = async () => {
    const email = octaneLookupEmail.trim();
    if (!email) return;
    setOctaneLookupLoading(true);
    setOctaneLookupResult(null);
    try {
      const res = await fetch(
        `/api/dashboard/octane/users/by-email?email=${encodeURIComponent(email)}`
      );
      const data = await res.json();
      if (res.ok) {
        setOctaneLookupResult({
          ok: true,
          user: data as OctaneLookupUser,
        });
      } else {
        setOctaneLookupResult({
          ok: false,
          error: data.error ?? "Lookup failed",
        });
      }
    } catch (e) {
      setOctaneLookupResult({
        ok: false,
        error: e instanceof Error ? e.message : "Request failed",
      });
    } finally {
      setOctaneLookupLoading(false);
    }
  };

  const runPayloads = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      setResult({ ok: false, message: "Select at least one athlete." });
      return;
    }
    if (SINGLE_ATHLETE_PAYLOAD_IDS.includes(payloadType) && ids.length > 1) {
      setResult({ ok: false, message: "This payload type supports one athlete at a time." });
      return;
    }

    setRunning(true);
    setResult(null);
    try {
      if (SINGLE_ATHLETE_PAYLOAD_IDS.includes(payloadType)) {
        const apiPath = PAYLOAD_TYPES.find((t) => t.id === payloadType)?.api ?? "";
        const res = await fetch(
          `${apiPath}?athleteUuid=${encodeURIComponent(ids[0])}`
        );
        const data = await res.json();
        if (!res.ok) {
          setResult({ ok: false, message: data.error ?? `Failed to generate ${payloadType} payload.`, data });
          return;
        }
        setResult({
          ok: true,
          message: `${PAYLOAD_TYPES.find((t) => t.id === payloadType)?.label ?? payloadType} payload generated.`,
          data,
        });
      } else {
        const results: unknown[] = [];
        for (const uuid of ids) {
          const res = await fetch(
            `/api/dashboard/payloads/report?athleteUuid=${encodeURIComponent(uuid)}`
          );
          const data = await res.json();
          if (!res.ok) {
            setResult({ ok: false, message: data.error ?? "Failed for " + uuid, data });
            return;
          }
          results.push(data);
        }
        setResult({
          ok: true,
          message: `Generated ${results.length} report payload(s).`,
          data: results.length === 1 ? results[0] : { count: results.length, payloads: results },
        });
      }
    } catch (e) {
      setResult({
        ok: false,
        message: e instanceof Error ? e.message : "Request failed",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h1 style={{ marginBottom: "0.5rem", fontSize: "1.75rem" }}>
        Send payload
      </h1>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Select athletes and payload type, then generate. You can run multiple report payloads at once; all other types are one athlete at a time.
        Each payload uses the <strong>most recent session</strong> (or best by velocity for pitching) per test type—Run All sends only that.
      </p>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>
          Octane user lookup
        </h2>
        <p className="text-muted" style={{ margin: "0 0 0.75rem", fontSize: "13px" }}>
          Look up a user in the Octane app by email to verify they exist or get their Octane UUID.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="email"
            value={octaneLookupEmail}
            onChange={(e) => setOctaneLookupEmail(e.target.value)}
            placeholder="athlete@example.com"
            style={{ padding: "0.5rem 0.75rem", minWidth: "220px" }}
            onKeyDown={(e) => e.key === "Enter" && runOctaneLookup()}
          />
          <button
            type="button"
            className="btn-primary"
            onClick={runOctaneLookup}
            disabled={octaneLookupLoading || !octaneLookupEmail.trim()}
          >
            {octaneLookupLoading ? "Looking up…" : "Look up"}
          </button>
        </div>
        {octaneLookupResult && (
          <div
            className="card"
            style={{
              marginTop: "1rem",
              borderWidth: "1px",
              borderStyle: "solid",
              borderColor: octaneLookupResult.ok ? "var(--accent)" : "var(--accent-secondary)",
            }}
          >
            {octaneLookupResult.ok ? (
              <>
                <p style={{ margin: "0 0 0.5rem", color: "var(--accent)" }}>
                  User found
                </p>
                <pre
                  style={{
                    margin: 0,
                    padding: "0.75rem",
                    background: "var(--bg-primary)",
                    borderRadius: "6px",
                    fontSize: "12px",
                    overflow: "auto",
                    maxHeight: "200px",
                  }}
                >
                  {JSON.stringify(octaneLookupResult.user, null, 2)}
                </pre>
              </>
            ) : (
              <p style={{ margin: 0, color: "var(--accent-secondary)" }}>
                {octaneLookupResult.error}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>
          Payload type
        </h2>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          {PAYLOAD_TYPES.map((t) => (
            <label key={t.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="radio"
                name="payloadType"
                checked={payloadType === t.id}
                onChange={() => setPayloadType(t.id)}
              />
              {t.label}
            </label>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h2 style={{ margin: 0, fontSize: "1rem" }}>
            Select athletes
          </h2>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn-ghost" onClick={selectAll}>
              Select all
            </button>
            <button type="button" className="btn-ghost" onClick={clearSelection}>
              Clear
            </button>
          </div>
        </div>
        {loading ? (
          <p className="text-muted">Loading athletes…</p>
        ) : (
          <div style={{ maxHeight: "320px", overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: "40px" }}></th>
                  <th>Name</th>
                  <th>Pitching</th>
                  <th>Athletic screen</th>
                  <th>Proteus</th>
                </tr>
              </thead>
              <tbody>
                {athletes.map((a) => (
                  <tr key={a.athlete_uuid}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(a.athlete_uuid)}
                        onChange={() => toggleAthlete(a.athlete_uuid)}
                      />
                    </td>
                    <td>{a.name}</td>
                    <td>{a.pitching_session_count}</td>
                    <td>{a.athletic_screen_session_count}</td>
                    <td>{a.proteus_session_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted" style={{ marginTop: "0.5rem", fontSize: "13px" }}>
          Date filter for tests can be added in a future update.
        </p>
      </div>

      <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn-primary"
          onClick={runPayloads}
          disabled={running || selectedIds.size === 0}
        >
          {running ? "Generating…" : selectedIds.size > 1 ? "Run All" : "Generate payload(s)"}
        </button>
        {selectedIds.size > 1 && (
          <span className="text-muted" style={{ fontSize: "13px" }}>
            Run All uses the most recent instance per test for each selected athlete.
          </span>
        )}
      </div>

      {result && (
        <div
          className="card"
          style={{
            borderColor: result.ok ? "var(--accent)" : "var(--accent-secondary)",
            borderWidth: "1px",
            borderStyle: "solid",
          }}
        >
          <p style={{ margin: "0 0 0.5rem", color: result.ok ? "var(--accent)" : "var(--accent-secondary)" }}>
            {result.message}
          </p>
          {result.ok && result.data !== undefined && payloadType === "report" && (() => {
            const data = result.data as { athlete?: { name?: string; email?: string | null; octaneAppUuid?: string | null }; payloads?: { athlete?: { name?: string; email?: string | null; octaneAppUuid?: string | null } }[] };
            const athletes = data.payloads
              ? data.payloads.map((p) => p.athlete).filter(Boolean)
              : data.athlete
                ? [data.athlete]
                : [];
            return athletes.length > 0 ? (
              <div style={{ marginBottom: "0.75rem", fontSize: "13px" }}>
                {athletes.map((a, i) => {
                  const name = a?.name ?? "Unknown";
                  const email = a?.email ?? null;
                  const matched = a?.octaneAppUuid != null && a.octaneAppUuid !== "";
                  return (
                    <p key={i} style={{ margin: "0.25rem 0" }}>
                      {matched && email
                        ? `Athlete ${name} matched with Octane via email: ${email}`
                        : email
                          ? `${name} — Octane not linked yet (update athlete email to resolve)`
                          : `${name} — No email on profile (add email to link with Octane)`}
                    </p>
                  );
                })}
              </div>
            ) : null;
          })()}
          {result.data !== undefined && (
            <pre
              style={{
                margin: 0,
                padding: "0.75rem",
                background: "var(--bg-primary)",
                borderRadius: "6px",
                fontSize: "12px",
                overflow: "auto",
                maxHeight: "300px",
              }}
            >
              {JSON.stringify(result.data, null, 2)}
            </pre>
          )}
        </div>
      )}

      <p className="text-muted" style={{ marginTop: "1.5rem", fontSize: "13px" }}>
        <Link href="/dashboard/athletes">Browse athletes</Link> to see full session counts.
      </p>
    </div>
  );
}

export default function SendPayloadPage() {
  return (
    <AdminGuard>
      <Suspense fallback={<div className="text-muted">Loading…</div>}>
        <SendPayloadContent />
      </Suspense>
    </AdminGuard>
  );
}
