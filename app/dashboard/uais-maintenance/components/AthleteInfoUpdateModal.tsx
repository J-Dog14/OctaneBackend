"use client";

import Link from "next/link";

export interface MismatchItem {
  uuid: string;
  name: string;
  heightStored?: number;
  heightIncoming?: number;
  weightStored?: number;
  weightIncoming?: number;
}

interface Props {
  item: MismatchItem | null;
  saving: boolean;
  onConfirm: () => void;
  onSkip: () => void;
}

export function AthleteInfoUpdateModal({ item, saving, onConfirm, onSkip }: Props) {
  if (!item) return null;

  const rows: { label: string; stored: number; incoming: number }[] = [];
  if (item.heightStored !== undefined && item.heightIncoming !== undefined) {
    rows.push({ label: "Height (in)", stored: item.heightStored, incoming: item.heightIncoming });
  }
  if (item.weightStored !== undefined && item.weightIncoming !== undefined) {
    rows.push({ label: "Weight (lbs)", stored: item.weightStored, incoming: item.weightIncoming });
  }

  return (
    <div
      className="card"
      style={{
        marginBottom: "1rem",
        borderColor: "var(--accent-secondary)",
        borderWidth: "1px",
        borderStyle: "solid",
      }}
    >
      <h3 style={{ margin: "0 0 0.5rem" }}>Athlete measurements changed</h3>
      <p className="text-muted" style={{ marginBottom: "0.75rem" }}>
        Incoming data for{" "}
        <Link href={`/dashboard/athletes/${item.uuid}`}>{item.name}</Link> differs from what&apos;s
        on file. Update their profile with the new values?
      </p>
      <table style={{ marginBottom: "0.75rem", borderCollapse: "collapse", fontSize: "14px" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", paddingRight: "1.5rem", fontWeight: 600 }}>Field</th>
            <th style={{ textAlign: "right", paddingRight: "1.5rem", fontWeight: 600 }}>On file</th>
            <th style={{ textAlign: "right", fontWeight: 600 }}>Incoming</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td style={{ paddingRight: "1.5rem", color: "var(--text-muted)" }}>{r.label}</td>
              <td style={{ textAlign: "right", paddingRight: "1.5rem" }}>{r.stored}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{r.incoming}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted" style={{ marginBottom: "0.75rem", fontSize: "13px" }}>
        Only the athlete profile (d_athletes) will be updated — historical session data is not
        changed.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" className="btn-primary" onClick={onConfirm} disabled={saving}>
          {saving ? "Saving…" : "Yes, update profile"}
        </button>
        <button type="button" className="btn-ghost" onClick={onSkip}>
          Keep existing
        </button>
      </div>
    </div>
  );
}
