"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { AdminGuard } from "@/app/dashboard/AdminGuard";
import { useAthleteSearch } from "@/hooks/useAthleteSearch";
import { AthleteSearchDropdown } from "@/app/dashboard/reports/components/AthleteSearchDropdown";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule, type ColDef } from "ag-grid-community";
import { octaneTheme } from "@/app/dashboard/ag-grid-theme";

ModuleRegistry.registerModules([AllCommunityModule]);

type AthleteRow = {
  athlete_uuid: string;
  name: string;
  gender: string | null;
  age_group: string | null;
  email?: string | null;
  pitching_session_count: number;
  athletic_screen_session_count: number;
  proteus_session_count: number;
  mobility_session_count: number;
  readiness_screen_session_count: number;
  arm_action_session_count: number;
  hitting_session_count: number;
  curveball_test_session_count: number;
};

type OctaneLookupUser = {
  uuid: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
  image: string | null;
};

type DomainInfo = { domainId: string; dates: string[] };
type LastSentSessions = Record<string, string>;

const DOMAIN_LABELS: Record<string, string> = {
  pitching: "Pitching",
  hitting: "Hitting",
  mobility: "Mobility",
  athleticScreen: "Athletic Screen",
  armAction: "Arm Action",
  proteus: "Proteus",
};

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function SendPayloadContent() {
  const {
    athleteQuery, setAthleteQuery,
    athleteOptions, athleteSelected, setAthleteSelected,
    dropdownOpen, setDropdownOpen,
  } = useAthleteSearch();

  const [domains, setDomains] = useState<DomainInfo[]>([]);
  const [domainsLoading, setDomainsLoading] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Record<string, string>>({});
  const [lastSentSessions, setLastSentSessions] = useState<LastSentSessions>({});

  const [sendStatus, setSendStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [sendError, setSendError] = useState<string | null>(null);

  const [octaneLookupEmail, setOctaneLookupEmail] = useState("");
  const [octaneLookupLoading, setOctaneLookupLoading] = useState(false);
  const [octaneLookupResult, setOctaneLookupResult] = useState<
    { ok: true; user: OctaneLookupUser } | { ok: false; error: string } | null
  >(null);

  const gridRef = useRef<AgGridReact<AthleteRow>>(null);
  const [tableData, setTableData] = useState<AthleteRow[] | null>(null);
  const [tableLoading, setTableLoading] = useState(true);
  const [filterText, setFilterText] = useState("");

  useEffect(() => {
    fetch("/api/dashboard/athletes?limit=10000")
      .then((r) => r.json())
      .then((d) => setTableData((d.items as AthleteRow[]) ?? []))
      .finally(() => setTableLoading(false));
  }, []);

  useEffect(() => {
    if (!athleteSelected) {
      setDomains([]);
      setSelectedDates({});
      setLastSentSessions({});
      setSendStatus("idle");
      setSendError(null);
      return;
    }
    setDomainsLoading(true);
    fetch(`/api/dashboard/athlete-tracking/sessions?athleteUuid=${athleteSelected.athlete_uuid}`)
      .then((r) => r.json())
      .then((d) => {
        const loaded = (d.domains as DomainInfo[]) ?? [];
        setDomains(loaded);
        // Default each domain to its most recent session date
        const defaults: Record<string, string> = {};
        for (const domain of loaded) {
          if (domain.dates.length > 0) defaults[domain.domainId] = domain.dates[0];
        }
        setSelectedDates(defaults);
        setLastSentSessions((d.lastSentSessions as LastSentSessions) ?? {});
      })
      .finally(() => setDomainsLoading(false));
  }, [athleteSelected]);

  const handleSendToApp = useCallback(async () => {
    if (!athleteSelected) return;
    setSendStatus("sending");
    setSendError(null);
    try {
      const res = await fetch("/api/dashboard/send-to-octane", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athleteUuid: athleteSelected.athlete_uuid,
          sessionDates: selectedDates,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setSendStatus("error");
        setSendError(data.error ?? "Unknown error");
      } else {
        setSendStatus("success");
        // Update local lastSentSessions to reflect what was just sent
        setLastSentSessions((prev) => ({ ...prev, ...selectedDates }));
      }
    } catch (err) {
      setSendStatus("error");
      setSendError(err instanceof Error ? err.message : "Network error");
    }
  }, [athleteSelected, selectedDates]);

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
        setOctaneLookupResult({ ok: true, user: data as OctaneLookupUser });
      } else {
        setOctaneLookupResult({ ok: false, error: (data as { error?: string }).error ?? "Lookup failed" });
      }
    } catch (e) {
      setOctaneLookupResult({ ok: false, error: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setOctaneLookupLoading(false);
    }
  };

  const columnDefs = useMemo<ColDef<AthleteRow>[]>(
    () => [
      {
        headerName: "Name",
        field: "name",
        flex: 2,
        minWidth: 150,
        pinned: "left",
        checkboxSelection: true,
      },
      { headerName: "Pitching",        field: "pitching_session_count",         flex: 1, minWidth: 90  },
      { headerName: "Hitting",         field: "hitting_session_count",           flex: 1, minWidth: 80  },
      { headerName: "Mobility",        field: "mobility_session_count",          flex: 1, minWidth: 90  },
      { headerName: "Athletic Screen", field: "athletic_screen_session_count",   flex: 1, minWidth: 130 },
      { headerName: "Arm Action",      field: "arm_action_session_count",        flex: 1, minWidth: 110 },
      { headerName: "Proteus",         field: "proteus_session_count",           flex: 1, minWidth: 90  },
      { headerName: "Readiness",       field: "readiness_screen_session_count",  flex: 1, minWidth: 100 },
      { headerName: "Curveball",       field: "curveball_test_session_count",    flex: 1, minWidth: 100 },
    ],
    []
  );

  const defaultColDef = useMemo<ColDef>(() => ({ sortable: true, resizable: true }), []);

  const sendDisabled =
    !athleteSelected ||
    domainsLoading ||
    domains.length === 0 ||
    sendStatus === "sending";

  return (
    <div>
      <h1 style={{ marginBottom: "0.5rem", fontSize: "1.75rem" }}>Send to App</h1>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Search for an athlete, choose which session to send per domain, then push to their Octane
        account. Domains with multiple sessions show a date dropdown. A yellow badge appears if the
        selected session was already sent.
      </p>

      {/* Athlete Search + Send */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Select athlete</h2>
        <AthleteSearchDropdown
          athleteQuery={athleteQuery}
          setAthleteQuery={setAthleteQuery}
          athleteOptions={athleteOptions}
          athleteSelected={athleteSelected}
          setAthleteSelected={setAthleteSelected}
          dropdownOpen={dropdownOpen}
          setDropdownOpen={setDropdownOpen}
        />

        {athleteSelected && (
          <div style={{ marginTop: "0.75rem" }}>
            {domainsLoading ? (
              <p className="text-muted" style={{ fontSize: "13px" }}>Loading session data…</p>
            ) : domains.length === 0 ? (
              <p className="text-muted" style={{ fontSize: "13px" }}>
                No assessment data found for this athlete.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {domains.map((d) => {
                  const chosen = selectedDates[d.domainId] ?? d.dates[0];
                  const alreadySent = lastSentSessions[d.domainId] === chosen;
                  return (
                    <div
                      key={d.domainId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          padding: "4px 10px",
                          borderRadius: 20,
                          border: "1px solid var(--accent)",
                          fontSize: "12px",
                          color: "var(--accent)",
                          whiteSpace: "nowrap",
                          minWidth: 110,
                          textAlign: "center",
                        }}
                      >
                        <strong>{DOMAIN_LABELS[d.domainId] ?? d.domainId}</strong>
                      </span>
                      {d.dates.length > 1 ? (
                        <select
                          value={chosen}
                          onChange={(e) =>
                            setSelectedDates((prev) => ({
                              ...prev,
                              [d.domainId]: e.target.value,
                            }))
                          }
                          style={{
                            fontSize: "12px",
                            padding: "3px 6px",
                            borderRadius: 6,
                            border: "1px solid var(--border)",
                            background: "var(--bg-secondary)",
                            color: "var(--text-primary)",
                          }}
                        >
                          {d.dates.map((date) => (
                            <option key={date} value={date}>
                              {formatDate(date)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ fontSize: "12px", color: "var(--text-primary)" }}>
                          {formatDate(d.dates[0])}
                        </span>
                      )}
                      {alreadySent && (
                        <span
                          style={{
                            fontSize: "11px",
                            padding: "2px 8px",
                            borderRadius: 20,
                            background: "#ffe066",
                            color: "#7a5900",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                          }}
                        >
                          Already sent
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div
          style={{
            marginTop: "1rem",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleSendToApp()}
            disabled={sendDisabled}
            style={{ opacity: sendDisabled ? 0.5 : 1 }}
          >
            {sendStatus === "sending" ? "Sending…" : "Send to App"}
          </button>
          {sendStatus === "success" && (
            <span style={{ color: "#40c057", fontSize: "13px" }}>✓ Sent successfully</span>
          )}
          {sendStatus === "error" && (
            <span style={{ color: "#fa5252", fontSize: "13px" }}>✗ {sendError}</span>
          )}
          {!athleteSelected && (
            <span className="text-muted" style={{ fontSize: "13px" }}>
              Select an athlete to enable
            </span>
          )}
        </div>
      </div>

      {/* Octane user lookup */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Octane user lookup</h2>
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
            onKeyDown={(e) => { if (e.key === "Enter") void runOctaneLookup(); }}
          />
          <button
            type="button"
            className="btn-primary"
            onClick={() => void runOctaneLookup()}
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
                <p style={{ margin: "0 0 0.5rem", color: "var(--accent)" }}>User found</p>
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

      {/* Athletes table */}
      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.5rem",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1rem" }}>Athletes</h2>
          <input
            type="text"
            placeholder="Search…"
            value={filterText}
            onChange={(e) => {
              const val = e.target.value;
              setFilterText(val);
              gridRef.current?.api?.setGridOption("quickFilterText", val);
            }}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              fontSize: "13px",
            }}
          />
        </div>
        <p className="text-muted" style={{ marginBottom: "0.75rem", fontSize: "13px" }}>
          Click a row to select that athlete above.
        </p>
        <div style={{ height: "calc(100vh - 420px)", minHeight: 350 }}>
          <AgGridReact
            theme={octaneTheme}
            ref={gridRef}
            rowData={tableData}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            loading={tableLoading}
            pagination
            paginationPageSize={50}
            rowSelection="single"
            suppressCellFocus
            onRowClicked={({ data }) => {
              if (!data) return;
              setAthleteSelected({ athlete_uuid: data.athlete_uuid, name: data.name });
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </div>
      </div>
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
