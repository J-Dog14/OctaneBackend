"use client";

import type { AthleteOption } from "@/app/dashboard/uais-maintenance/types";

interface Props {
  athlete: AthleteOption | null;
  emailValue: string;
  setEmailValue: (v: string) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}

export function UpdateEmailModal({ athlete, emailValue, setEmailValue, saving, onSave, onCancel }: Props) {
  if (!athlete) return null;

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
      <h3 style={{ margin: "0 0 0.5rem" }}>Update email for {athlete.name}</h3>
      <input
        type="email"
        value={emailValue}
        onChange={(e) => setEmailValue(e.target.value)}
        placeholder="Email"
        style={{ marginBottom: "0.5rem", display: "block", width: "100%", maxWidth: "320px" }}
      />
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" className="btn-primary" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
