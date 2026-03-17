"use client";

import { useState, useEffect, useCallback } from "react";

type Settings = Record<string, string>;

const SETTING_GROUPS = [
  {
    title: "Octane App Integration",
    description: "Connect this dashboard to your Octane athlete app.",
    keys: [
      { key: "octane_app_url", label: "Octane App URL", placeholder: "https://your-octane-app.vercel.app", type: "url" },
      { key: "octane_api_key", label: "Octane API Key", placeholder: "Bearer token for Octane API", type: "password" },
    ],
  },
  {
    title: "Proteus Integration",
    description: "Credentials used by the Proteus data runner.",
    keys: [
      { key: "proteus_email", label: "Proteus Email", placeholder: "you@yourdomain.com", type: "email" },
      { key: "proteus_password", label: "Proteus Password", placeholder: "Proteus account password", type: "password" },
      { key: "proteus_location", label: "Proteus Location Slug", placeholder: "yourlocationslug", type: "text" },
    ],
  },
  {
    title: "UAIS Warehouse Database",
    description: "Connection string for the warehouse database used by the UAIS scripts. Passed as WAREHOUSE_DATABASE_URL to each runner at runtime.",
    keys: [
      { key: "uais_warehouse_db_url", label: "Warehouse Database URL", placeholder: "postgresql://user:password@host:5432/dbname?sslmode=require", type: "password" },
    ],
  },
  {
    title: "Runner Data Directories",
    description: "Local paths where each runner looks for its raw input data. Set the folder for each assessment type you use.",
    keys: [
      { key: "uais_data_dir_athletic_screen", label: "Athletic Screen Data Directory", placeholder: "/path/to/athletic-screen/output", type: "text" },
      { key: "uais_data_dir_readiness_screen", label: "Readiness Screen Data Directory", placeholder: "/path/to/readiness-screen/data", type: "text" },
      { key: "uais_data_dir_pro_sup", label: "Pro Sup Data Directory", placeholder: "/path/to/pro-sup/data", type: "text" },
      { key: "uais_data_dir_arm_action", label: "Arm Action Data Directory", placeholder: "/path/to/arm-action/exports", type: "text" },
      { key: "uais_data_dir_pitching", label: "Pitching Data Directory", placeholder: "/path/to/pitching/data", type: "text" },
      { key: "uais_data_dir_hitting", label: "Hitting Data Directory", placeholder: "/path/to/hitting/data", type: "text" },
      { key: "uais_data_dir_curveball", label: "Curveball Data Directory", placeholder: "/path/to/curveball/data", type: "text" },
      { key: "uais_data_dir_mobility", label: "Mobility Data Directory", placeholder: "/path/to/mobility/data", type: "text" },
      { key: "uais_data_dir_proteus", label: "Proteus Data Directory", placeholder: "/path/to/proteus/data", type: "text" },
    ],
  },
  {
    title: "Assessment Configuration",
    description: "Optional overrides for assessment behaviour.",
    keys: [
      { key: "capture_rate", label: "Capture Rate (Hz)", placeholder: "300", type: "number" },
    ],
  },
  {
    title: "Cloud Storage",
    description: "Cloudflare R2 credentials and prefix for this org's uploaded assessment files.",
    keys: [
      { key: "r2_account_id", label: "R2 Account ID", placeholder: "Cloudflare account ID", type: "password" },
      { key: "r2_access_key_id", label: "R2 Access Key ID", placeholder: "R2 API token access key", type: "password" },
      { key: "r2_secret_access_key", label: "R2 Secret Access Key", placeholder: "R2 API token secret key", type: "password" },
      { key: "r2_bucket_name", label: "R2 Bucket Name", placeholder: "octane-backend", type: "text" },
      { key: "r2_uploads_prefix", label: "R2 Uploads Prefix", placeholder: "org-name/uploads", type: "text" },
    ],
  },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [draft, setDraft] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/settings");
      const data = await res.json() as { settings: Settings };
      setSettings(data.settings ?? {});
      setDraft(data.settings ?? {});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleChange = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/dashboard/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: draft }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setSaveError(err.error ?? "Save failed");
        return;
      }
      const data = await res.json() as { settings: Settings };
      setSettings(data.settings ?? {});
      setDraft(data.settings ?? {});
      setSavedAt(new Date());
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const isDirty = JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", margin: 0 }}>Settings</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {savedAt && !isDirty && (
            <span className="text-muted" style={{ fontSize: "13px" }}>
              Saved {savedAt.toLocaleTimeString()}
            </span>
          )}
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={saving || !isDirty}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
      <p className="text-muted" style={{ marginBottom: "2rem" }}>
        Configure org-specific settings. Changes take effect immediately without redeployment.
      </p>

      {saveError && (
        <div style={{ color: "var(--error, #e53e3e)", marginBottom: "1rem", padding: "0.75rem 1rem", background: "rgba(229,62,62,0.1)", borderRadius: "6px" }}>
          {saveError}
        </div>
      )}

      {loading ? (
        <p className="text-muted">Loading settings…</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {SETTING_GROUPS.map((group) => (
            <section key={group.title} className="card">
              <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.05rem" }}>{group.title}</h2>
              <p className="text-muted" style={{ margin: "0 0 1.25rem", fontSize: "13px" }}>{group.description}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {group.keys.map(({ key, label, placeholder, type }) => (
                  <div key={key}>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                      {label}
                    </label>
                    <input
                      type={type === "password" ? "text" : type}
                      value={draft[key] ?? ""}
                      onChange={(e) => handleChange(key, e.target.value)}
                      placeholder={placeholder}
                      style={{ width: "100%", maxWidth: "480px", fontFamily: type === "password" ? "monospace" : undefined }}
                    />
                    <div className="text-muted" style={{ fontSize: "11px", marginTop: "2px" }}>
                      key: <code>{key}</code>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
