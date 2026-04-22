"use client";

interface Props {
  modal: { jobId: string; date: string } | null;
  onResponse: (response: "yes" | "no") => void;
}

export function DuplicateSessionModal({ modal, onResponse }: Props) {
  if (!modal) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="duplicate-session-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={(e) => e.target === e.currentTarget && onResponse("no")}
    >
      <div
        className="card"
        style={{
          maxWidth: "400px",
          margin: "1rem",
          borderColor: "var(--accent-secondary)",
          borderWidth: "1px",
          borderStyle: "solid",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="duplicate-session-title" style={{ margin: "0 0 0.5rem" }}>
          Duplicate session?
        </h3>
        <p className="text-muted" style={{ marginBottom: "1rem" }}>
          It looks like you already ran this data for the following date:{" "}
          <strong>{modal.date}</strong>. Are you sure you want to continue?
        </p>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button type="button" className="btn-primary" onClick={() => onResponse("yes")}>
            Yes
          </button>
          <button type="button" className="btn-ghost" onClick={() => onResponse("no")}>
            No
          </button>
        </div>
      </div>
    </div>
  );
}
