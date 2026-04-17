"use client";

import Link from "next/link";
import type { AthleteOption } from "@/app/dashboard/uais-maintenance/types";

interface DuplicateMatch {
  athlete_uuid: string;
  name: string;
  email: string | null;
}

interface Props {
  runMode: "new" | "existing";
  setRunMode: (m: "new" | "existing") => void;
  // New mode — duplicate check
  checkDuplicatesQuery: string;
  setCheckDuplicatesQuery: (q: string) => void;
  checkDuplicatesResult: DuplicateMatch[] | null;
  setCheckDuplicatesResult: (r: DuplicateMatch[] | null) => void;
  checkDuplicatesLoading: boolean;
  onCheckDuplicates: () => void;
  // Existing mode — athlete search
  filterNonApp: boolean;
  setFilterNonApp: (v: boolean) => void;
  athleteSearch: string;
  setAthleteSearch: (s: string) => void;
  athleteOptions: AthleteOption[];
  athleteSelected: AthleteOption | null;
  setAthleteSelected: (a: AthleteOption | null) => void;
  athleteDropdownOpen: boolean;
  setAthleteDropdownOpen: (o: boolean) => void;
  onOpenUpdateEmail: (a: AthleteOption) => void;
}

const hasNoEmail = (a: AthleteOption) => a.email == null || a.email === "";

export function UaisAthleteSelector({
  runMode,
  setRunMode,
  checkDuplicatesQuery,
  setCheckDuplicatesQuery,
  checkDuplicatesResult,
  setCheckDuplicatesResult,
  checkDuplicatesLoading,
  onCheckDuplicates,
  filterNonApp,
  setFilterNonApp,
  athleteSearch,
  setAthleteSearch,
  athleteOptions,
  athleteSelected,
  setAthleteSelected,
  athleteDropdownOpen,
  setAthleteDropdownOpen,
  onOpenUpdateEmail,
}: Props) {
  return (
    <div
      style={{
        marginBottom: "1rem",
        display: "flex",
        flexWrap: "wrap",
        gap: "1rem",
        alignItems: "center",
      }}
    >
      {/* Run mode radio buttons */}
      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="radio"
          name="runMode"
          checked={runMode === "new"}
          onChange={() => setRunMode("new")}
        />
        New Athlete
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="radio"
          name="runMode"
          checked={runMode === "existing"}
          onChange={() => {
            setRunMode("existing");
            setCheckDuplicatesResult(null);
          }}
        />
        Existing Athlete
      </label>

      {/* New athlete — duplicate check */}
      {runMode === "new" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <input
              type="text"
              value={checkDuplicatesQuery}
              onChange={(e) => {
                setCheckDuplicatesQuery(e.target.value);
                setCheckDuplicatesResult(null);
              }}
              placeholder="Check for duplicates (name or email)"
              style={{ minWidth: "200px", padding: "0.35rem 0.5rem" }}
            />
            <button
              type="button"
              className="btn-ghost"
              onClick={onCheckDuplicates}
              disabled={checkDuplicatesLoading || !checkDuplicatesQuery.trim()}
            >
              {checkDuplicatesLoading ? "Checking…" : "Check"}
            </button>
            {checkDuplicatesResult !== null && (
              <span className="text-muted" style={{ fontSize: "13px" }}>
                {checkDuplicatesResult.length === 0
                  ? "No matches."
                  : `${checkDuplicatesResult.length} possible existing athlete(s). Use Existing Athlete instead?`}
              </span>
            )}
          </div>
          {checkDuplicatesResult != null && checkDuplicatesResult.length > 0 && (
            <ul style={{ margin: "0.25rem 0 0 1rem", paddingLeft: "1rem", fontSize: "14px" }}>
              {checkDuplicatesResult.map((a) => (
                <li key={a.athlete_uuid}>
                  <Link href={`/dashboard/athletes/${a.athlete_uuid}`}>{a.name}</Link>
                  {a.email && <span className="text-muted"> — {a.email}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Existing athlete — search + filter */}
      {runMode === "existing" && (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={filterNonApp}
              onChange={(e) => setFilterNonApp(e.target.checked)}
            />
            Filter Non App Athletes
          </label>
          <div style={{ position: "relative" }}>
            <input
              type="text"
              value={athleteSelected ? athleteSelected.name : athleteSearch}
              onChange={(e) => {
                setAthleteSelected(null);
                setAthleteSearch(e.target.value);
                setAthleteDropdownOpen(true);
              }}
              onFocus={() => setAthleteDropdownOpen(true)}
              onBlur={() => setTimeout(() => setAthleteDropdownOpen(false), 150)}
              placeholder="Search athletes…"
              style={{ minWidth: "220px", padding: "0.35rem 0.5rem" }}
            />
            {athleteDropdownOpen && athleteOptions.length > 0 && (
              <ul
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  margin: 0,
                  padding: "0.25rem 0",
                  listStyle: "none",
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  maxHeight: "200px",
                  overflow: "auto",
                  zIndex: 10,
                }}
              >
                {athleteOptions.map((a) => (
                  <li
                    key={a.athlete_uuid}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setAthleteSelected(a);
                      setAthleteSearch(a.name);
                      setAthleteDropdownOpen(false);
                    }}
                    style={{ padding: "0.4rem 0.75rem", cursor: "pointer" }}
                  >
                    {a.name}
                    {hasNoEmail(a) && (
                      <span
                        className="text-muted"
                        style={{ marginLeft: "0.5rem", fontSize: "12px" }}
                      >
                        (no email)
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {athleteSelected && hasNoEmail(athleteSelected) && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => onOpenUpdateEmail(athleteSelected)}
            >
              Update Email
            </button>
          )}
        </>
      )}
    </div>
  );
}
