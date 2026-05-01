"use client";

import Link from "next/link";

interface Props {
  item: { uuid: string; name: string } | null;
  dobValue: string;
  setDobValue: (v: string) => void;
  saving: boolean;
  onSave: () => void;
  onSkip: () => void;
}

export function MissingDobModal({ item, dobValue, setDobValue, saving, onSave, onSkip }: Props) {
  if (!item) return null;

  return (
    <div
      className="card"
      style={{
        marginBottom: "1rem",
        borderColor: "var(--accent)",
        borderWidth: "1px",
        borderStyle: "solid",
      }}
    >
      <h3 style={{ margin: "0 0 0.5rem" }}>Date of birth missing</h3>
      <p className="text-muted" style={{ marginBottom: "0.5rem" }}>
        No date of birth was found for{" "}
        <Link href={`/dashboard/athletes/${item.uuid}`}>{item.name}</Link>. Enter it to assign
        the correct skill level for percentile grouping.
      </p>
      <input
        type="date"
        value={dobValue}
        onChange={(e) => setDobValue(e.target.value)}
        style={{ marginBottom: "0.5rem", display: "block" }}
      />
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn-primary"
          onClick={onSave}
          disabled={saving || !dobValue}
        >
          {saving ? "Saving…" : "Save DOB"}
        </button>
        <button type="button" className="btn-ghost" onClick={onSkip}>
          Skip
        </button>
      </div>
      <p className="text-muted" style={{ marginTop: "0.5rem", fontSize: "13px" }}>
        Without a DOB, skill level cannot be assigned and this athlete will be grouped with other
        unknown-level athletes for percentiles.
      </p>
    </div>
  );
}
