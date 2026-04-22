"use client";

import type { AthleteOption } from "@/app/dashboard/reports/constants";

interface Props {
  athleteQuery: string;
  setAthleteQuery: (q: string) => void;
  athleteOptions: AthleteOption[];
  athleteSelected: AthleteOption | null;
  setAthleteSelected: (a: AthleteOption | null) => void;
  dropdownOpen: boolean;
  setDropdownOpen: (open: boolean) => void;
}

export function AthleteSearchDropdown({
  athleteQuery,
  setAthleteQuery,
  athleteOptions,
  athleteSelected,
  setAthleteSelected,
  dropdownOpen,
  setDropdownOpen,
}: Props) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <label
        style={{ display: "block", fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}
      >
        Athlete
      </label>
      <div style={{ position: "relative", width: 300 }}>
        <input
          type="text"
          placeholder="Search by name…"
          value={athleteSelected ? athleteSelected.name : athleteQuery}
          onChange={(e) => {
            setAthleteSelected(null);
            setAthleteQuery(e.target.value);
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid var(--border)",
          }}
        />
        {dropdownOpen && athleteOptions.length > 0 && !athleteSelected && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              zIndex: 10,
              maxHeight: 220,
              overflowY: "auto",
            }}
          >
            {athleteOptions.map((a) => (
              <button
                key={a.athlete_uuid}
                type="button"
                className="btn-ghost"
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  fontSize: "14px",
                  borderRadius: 0,
                }}
                onMouseDown={() => {
                  setAthleteSelected(a);
                  setAthleteQuery("");
                  setDropdownOpen(false);
                }}
              >
                {a.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {athleteSelected && (
        <div style={{ marginTop: "0.4rem", fontSize: "13px", color: "var(--text-secondary)" }}>
          Selected: <strong>{athleteSelected.name}</strong>{" "}
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: "12px", padding: "1px 6px" }}
            onClick={() => {
              setAthleteSelected(null);
              setAthleteQuery("");
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
