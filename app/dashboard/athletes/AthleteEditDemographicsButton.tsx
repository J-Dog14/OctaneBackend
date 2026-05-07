"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  athleteUuid: string;
  current: {
    dateOfBirth?: string | null;
    gender?: string | null;
    email?: string | null;
    height?: string | null;
    weight?: string | null;
  };
}

export function AthleteEditDemographicsButton({ athleteUuid, current }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [email, setEmail] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");

  const openModal = () => {
    setDob(current.dateOfBirth ? new Date(current.dateOfBirth).toISOString().slice(0, 10) : "");
    setGender(current.gender ?? "");
    setEmail(current.email ?? "");
    setHeight(current.height ?? "");
    setWeight(current.weight ?? "");
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: Record<string, any> = {};
      if (dob.trim()) body.date_of_birth = dob.trim();
      if (gender.trim()) body.gender = gender.trim();
      body.email = email.trim() || null;
      const h = parseFloat(height);
      if (!isNaN(h) && h > 0) body.height = h;
      const w = parseFloat(weight);
      if (!isNaN(w) && w > 0) body.weight = w;

      const res = await fetch(`/api/dashboard/athletes/${athleteUuid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed");
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    display: "block",
    width: "100%",
    padding: "0.4rem 0.5rem",
    marginTop: "0.25rem",
    marginBottom: "0.75rem",
    boxSizing: "border-box" as const,
  };

  const labelStyle = { fontSize: "13px", color: "var(--color-muted, #888)" };

  return (
    <>
      <button type="button" className="btn-ghost" onClick={openModal} style={{ padding: "0.2rem 0.5rem", fontSize: "13px" }}>
        Edit demographics
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: "fixed", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 20, minWidth: "340px", maxHeight: "90vh",
            overflowY: "auto",
            boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          }}
        >
          <h3 style={{ margin: "0 0 1rem" }}>Edit demographics</h3>

          <label style={labelStyle}>
            Date of birth
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} style={inputStyle} />
          </label>

          <label style={labelStyle}>
            Gender
            <input type="text" value={gender} onChange={(e) => setGender(e.target.value)} placeholder="e.g. Male, Female" style={inputStyle} />
          </label>

          <label style={labelStyle}>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="athlete@example.com" style={inputStyle} />
          </label>

          <label style={labelStyle}>
            Height (in)
            <input type="number" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="e.g. 72" min={0} step={0.1} style={inputStyle} />
          </label>

          <label style={labelStyle}>
            Weight (lbs)
            <input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="e.g. 185" min={0} step={0.1} style={inputStyle} />
          </label>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {open && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 19 }}
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
    </>
  );
}
