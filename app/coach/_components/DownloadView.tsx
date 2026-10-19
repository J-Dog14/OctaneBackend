"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Alert, Anchor, Button, Checkbox, Group, Loader, ScrollArea, Stack, Switch, Text, Title } from "@mantine/core";
import type { ExportCategoryId, ExportListing } from "@/lib/coach/export";
import { swrOpts, useCoachFetcher } from "./fetcher";

type Picked = Partial<Record<ExportCategoryId, Set<string>>>;

/** "2026-10-18" -> "10/18/26". */
function shortDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : "No date";
}

async function download(uuid: string, body: unknown): Promise<void> {
  const res = await fetch(`/api/coach/athletes/${encodeURIComponent(uuid)}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as { error?: string }).error ?? `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "athlete_data.zip";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function CategoryColumn({
  category,
  picked,
  onToggleAll,
  onToggle,
}: {
  category: ExportListing["categories"][number];
  picked: Set<string> | undefined;
  onToggleAll: (on: boolean) => void;
  onToggle: (date: string, on: boolean) => void;
}) {
  const n = picked?.size ?? 0;
  const total = category.sessions.length;
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "12px 12px 8px", minWidth: 0 }}>
      <Checkbox
        checked={n === total}
        indeterminate={n > 0 && n < total}
        onChange={(e) => onToggleAll(e.currentTarget.checked)}
        label={<Text fw={600} size="sm">{category.label}</Text>}
        description={`${total} session${total === 1 ? "" : "s"}${n ? ` · ${n} selected` : ""}`}
      />
      <ScrollArea.Autosize mah={440} mt="sm" type="auto" offsetScrollbars>
        <Stack gap={8} pl={4}>
          {category.sessions.map((s) => (
            <Checkbox
              key={s.date}
              size="xs"
              checked={picked?.has(s.date) ?? false}
              onChange={(e) => onToggle(s.date, e.currentTarget.checked)}
              label={shortDate(s.date)}
              description={s.detail || undefined}
            />
          ))}
        </Stack>
      </ScrollArea.Autosize>
    </div>
  );
}

export function DownloadView({ athleteUuid }: { athleteUuid: string }) {
  const fetcher = useCoachFetcher();
  const { data, error, isLoading } = useSWR<ExportListing>(`/api/coach/athletes/${encodeURIComponent(athleteUuid)}/export`, fetcher, swrOpts);
  const [picked, setPicked] = useState<Picked>({});
  const [raw, setRaw] = useState(false);
  const [busy, setBusy] = useState<"all" | "selected" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const hasRaw = useMemo(() => data?.categories.some((c) => c.sessions.some((s) => s.raw)) ?? false, [data]);
  const selectedCount = Object.values(picked).reduce((n, s) => n + (s?.size ?? 0), 0);
  const selectedTypes = Object.values(picked).filter((s) => s && s.size).length;

  if (isLoading) return <Loader />;
  if (error || !data) return <Alert color="red">{error?.message ?? "Athlete not found"}</Alert>;

  const back = `/coach/athletes/${encodeURIComponent(athleteUuid)}`;
  const setCategory = (id: ExportCategoryId, dates: string[]) => setPicked((p) => ({ ...p, [id]: new Set(dates) }));
  const toggle = (id: ExportCategoryId, date: string, on: boolean) =>
    setPicked((p) => {
      const next = new Set(p[id] ?? []);
      if (on) next.add(date);
      else next.delete(date);
      return { ...p, [id]: next };
    });

  const run = async (kind: "all" | "selected") => {
    setFailed(null);
    setBusy(kind);
    try {
      if (kind === "all") {
        await download(athleteUuid, { all: true, raw });
      } else {
        const categories: Record<string, string[] | "all"> = {};
        for (const c of data.categories) {
          const s = picked[c.id];
          if (!s?.size) continue;
          categories[c.id] = s.size === c.sessions.length ? "all" : [...s];
        }
        await download(athleteUuid, { categories, raw });
      }
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap="md" maw={1280} mx="auto">
      <div className="card" style={{ marginBottom: 0 }}>
        <Anchor component={Link} href={back} size="sm">← Back to {data.athlete.name}</Anchor>
        <Group justify="space-between" align="flex-end" wrap="wrap" gap="md" mt="xs">
          <div>
            <Title order={2} style={{ lineHeight: 1.15 }}>Download data</Title>
            <Text size="sm" c="dimmed" mt={4}>
              {data.athlete.name} · a ZIP with one CSV per data table and a README. Tick a column header for all of it, or pick sessions.
            </Text>
          </div>
          <Group gap="xs">
            <Button variant="default" loading={busy === "all"} disabled={busy != null || !data.categories.length} onClick={() => void run("all")}>
              Download all
            </Button>
            <Button loading={busy === "selected"} disabled={busy != null || !selectedCount} onClick={() => void run("selected")}>
              {selectedCount ? `Download selected (${selectedCount} session${selectedCount === 1 ? "" : "s"}${selectedTypes > 1 ? `, ${selectedTypes} types` : ""})` : "Download selected"}
            </Button>
          </Group>
        </Group>
        {hasRaw && (
          <Switch
            mt="md"
            size="sm"
            checked={raw}
            onChange={(e) => setRaw(e.currentTarget.checked)}
            label="Include raw 3D time series"
            description="Marker, segment and force-plate data for each biomechanics trial. Large files."
          />
        )}
        {busy && <Text size="xs" c="dimmed" mt="sm">Building the file… large histories can take a minute.</Text>}
        {failed && <Alert color="red" mt="sm">{failed}</Alert>}
      </div>

      {data.categories.length === 0 ? (
        <Text c="dimmed">No data on file for {data.athlete.name} yet.</Text>
      ) : (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", alignItems: "start" }}>
          {data.categories.map((c) => (
            <CategoryColumn
              key={c.id}
              category={c}
              picked={picked[c.id]}
              onToggleAll={(on) => setCategory(c.id, on ? c.sessions.map((s) => s.date) : [])}
              onToggle={(date, on) => toggle(c.id, date, on)}
            />
          ))}
        </div>
      )}
    </Stack>
  );
}
