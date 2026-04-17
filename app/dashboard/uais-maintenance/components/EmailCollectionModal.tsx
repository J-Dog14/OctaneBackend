"use client";

import Link from "next/link";

interface Props {
  emailPopup: { athleteUuid: string; name: string } | null;
  emailPopupValue: string;
  setEmailPopupValue: (v: string) => void;
  emailPopupSaving: boolean;
  onSave: () => void;
  onSkip: () => void;
}

export function EmailCollectionModal({
  emailPopup,
  emailPopupValue,
  setEmailPopupValue,
  emailPopupSaving,
  onSave,
  onSkip,
}: Props) {
  if (!emailPopup) return null;

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
      <h3 style={{ margin: "0 0 0.5rem" }}>Add email for this athlete?</h3>
      <p className="text-muted" style={{ marginBottom: "0.5rem" }}>
        <Link href={`/dashboard/athletes/${emailPopup.athleteUuid}`}>{emailPopup.name}</Link> has
        no email and won&apos;t be linkable to the app until one is set.
      </p>
      <input
        type="email"
        value={emailPopupValue}
        onChange={(e) => setEmailPopupValue(e.target.value)}
        placeholder="Email (optional)"
        style={{ marginBottom: "0.5rem", display: "block", width: "100%", maxWidth: "320px" }}
      />
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn-primary"
          onClick={onSave}
          disabled={emailPopupSaving}
        >
          {emailPopupSaving ? "Saving…" : "Save email"}
        </button>
        <button type="button" className="btn-ghost" onClick={onSkip}>
          Continue without email
        </button>
      </div>
      <p className="text-muted" style={{ marginTop: "0.5rem", fontSize: "13px" }}>
        If you continue without email: this athlete will not be able to be linked to the app.
      </p>
    </div>
  );
}
