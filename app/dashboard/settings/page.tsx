"use client";

import { useState, useEffect, useCallback } from "react";
import { AdminGuard } from "@/app/dashboard/AdminGuard";
import {
  Stack, Group, Title, Text, TextInput, Button, Paper, Alert, Badge, Code
} from "@mantine/core";

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
    description: "The folder on the Windows machine running OctaneSync where each assessment type's V3D output files live. The sync agent reads these paths and uploads files to R2 when you trigger a run.",
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

  // Sync Agent state
  const [agentToken, setAgentToken] = useState<string | null>(null);
  const [agentOnline, setAgentOnline] = useState(false);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, agentStatusRes] = await Promise.all([
        fetch("/api/dashboard/settings"),
        fetch("/api/sync/agent-status"),
      ]);
      const data = await settingsRes.json() as { settings: Settings };
      setSettings(data.settings ?? {});
      setDraft(data.settings ?? {});
      if (agentStatusRes.ok) {
        const agentData = await agentStatusRes.json() as { online: boolean };
        setAgentOnline(agentData.online);
      }
      // Show masked token if one exists
      if (data.settings?.agent_token) {
        setAgentToken(data.settings.agent_token);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const generateToken = async () => {
    setGeneratingToken(true);
    try {
      const res = await fetch("/api/sync/generate-token", { method: "POST" });
      const data = await res.json() as { token: string };
      setAgentToken(data.token);
      setTokenVisible(true);
    } finally {
      setGeneratingToken(false);
    }
  };

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
    <AdminGuard>
      <Stack gap="xl">
        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={1} mb={4}>Settings</Title>
            <Text c="dimmed">
              Configure org-specific settings. Changes take effect immediately without redeployment.
            </Text>
          </div>
          <Group gap="sm">
            {savedAt && !isDirty && (
              <Text size="sm" c="dimmed">Saved {savedAt.toLocaleTimeString()}</Text>
            )}
            <Button onClick={handleSave} disabled={saving || !isDirty} loading={saving}>
              Save changes
            </Button>
          </Group>
        </Group>

        {saveError && (
          <Alert color="red" variant="light">{saveError}</Alert>
        )}

        {loading ? (
          <Text c="dimmed">Loading settings…</Text>
        ) : (
          <Stack gap="lg">
            {/* Sync Agent card */}
            <Paper withBorder p="lg" radius="md">
              <Group justify="space-between" align="flex-start" mb={4}>
                <Title order={3} fz="md">Sync Agent</Title>
                <Badge color={agentOnline ? "green" : "gray"} variant="light">
                  {agentOnline ? "Online" : "Offline"}
                </Badge>
              </Group>
              <Text size="sm" c="dimmed" mb="md">
                The OctaneSync agent runs on each Windows data collection machine. When you trigger
                a run, it automatically uploads the right folder&apos;s files to R2 — no manual file
                selection needed. Configure the token below, then set it in the agent&apos;s config.json.
              </Text>
              <Stack gap="sm">
                {agentToken ? (
                  <div>
                    <Text size="sm" fw={500} mb={4}>Agent Token</Text>
                    <Group gap="sm" align="center">
                      <Code style={{ flex: 1, wordBreak: "break-all", maxWidth: 420 }}>
                        {tokenVisible ? agentToken : "•".repeat(32)}
                      </Code>
                      <Button size="xs" variant="subtle" onClick={() => setTokenVisible((v) => !v)}>
                        {tokenVisible ? "Hide" : "Show"}
                      </Button>
                      {tokenVisible && (
                        <Button size="xs" variant="subtle" onClick={() => void navigator.clipboard.writeText(agentToken)}>
                          Copy
                        </Button>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed" mt={4}>Paste this into config.json on the Windows machine.</Text>
                  </div>
                ) : (
                  <Text size="sm" c="dimmed">No token generated yet.</Text>
                )}
                <div>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={generateToken}
                    loading={generatingToken}
                  >
                    {agentToken ? "Regenerate Token" : "Generate Token"}
                  </Button>
                  {agentToken && (
                    <Text size="xs" c="orange" mt={4}>
                      Regenerating invalidates the current token — the agent will need to be reconfigured.
                    </Text>
                  )}
                </div>
              </Stack>
            </Paper>

            {SETTING_GROUPS.map((group) => (
              <Paper key={group.title} withBorder p="lg" radius="md">
                <Title order={3} fz="md" mb={4}>{group.title}</Title>
                <Text size="sm" c="dimmed" mb="md">{group.description}</Text>
                <Stack gap="md">
                  {group.keys.map(({ key, label, placeholder, type }) => (
                    <TextInput
                      key={key}
                      label={label}
                      placeholder={placeholder}
                      value={draft[key] ?? ""}
                      onChange={(e) => handleChange(key, e.target.value)}
                      type={type === "password" ? "text" : type}
                      styles={{
                        input: { fontFamily: type === "password" ? "var(--font-mono)" : undefined, maxWidth: 480 },
                      }}
                      description={<>key: <code>{key}</code></>}
                    />
                  ))}
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </Stack>
    </AdminGuard>
  );
}
