"use client";

import { Suspense, useEffect, useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Alert, Badge, Group, Loader, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { AthleteSearchSelect } from "./AthleteSearchSelect";
import { fmtDate, parseRecent, readRecentRaw, swrOpts, type CoachAthleteListItem } from "./fetcher";

const HAS_LABELS: Array<[keyof CoachAthleteListItem["has"], string]> = [
  ["pitching", "3D pitching"],
  ["hitting", "3D hitting"],
  ["armAction", "Arm action"],
  ["athleticScreen", "Screen"],
  ["mobility", "Mobility"],
  ["proSup", "Pro-sup"],
  ["readiness", "Readiness"],
  ["proteus", "Proteus"],
];

const noopSubscribe = () => () => {};

/**
 * /coach. Opens the last athlete this browser looked at; ?browse=1 (the
 * "All athletes" link) shows the search and lists instead.
 */
function AthletePickerInner() {
  const router = useRouter();
  const browse = useSearchParams().has("browse");
  const raw = useSyncExternalStore(noopSubscribe, readRecentRaw, () => "");
  const recent = useMemo(() => parseRecent(raw), [raw]);
  const last = recent[0];

  useEffect(() => {
    if (!browse && last) router.replace(`/coach/athletes/${last.athleteUuid}`);
  }, [browse, last, router]);

  const { data, isLoading, error } = useSWR<{ items: CoachAthleteListItem[] }>("/api/coach/athletes?limit=24", swrOpts);

  if (!browse && last) return <Loader />;

  return (
    <Stack gap="lg" maw={1200} mx="auto">
      <div>
        <Title order={2}>Pick an athlete</Title>
        <Text size="sm" c="dimmed">
          Everything on one page: pitch data, biomechanics, assessments, readiness and Proteus. You can compare from there.
        </Text>
      </div>

      <AthleteSearchSelect value={null} placeholder="Search by name…" size="md" w="100%" onChange={(v) => v && router.push(`/coach/athletes/${v}`)} />

      {recent.length > 0 && (
        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={6}>Recently viewed</Text>
          <Group gap={6}>
            {recent.map((a) => (
              <Badge key={a.athleteUuid} component={Link} href={`/coach/athletes/${a.athleteUuid}`} size="lg" variant="light" color="gray" style={{ textTransform: "none", cursor: "pointer" }}>
                {a.name}
              </Badge>
            ))}
          </Group>
        </div>
      )}

      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Recently updated</Text>
      {error && <Alert color="red">{error.message}</Alert>}
      {isLoading && <Loader size="sm" />}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {data?.items.map((a) => {
          const chips = HAS_LABELS.filter(([k]) => a.has[k]);
          return (
            <Link key={a.athleteUuid} href={`/coach/athletes/${a.athleteUuid}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%", marginBottom: 0, cursor: "pointer" }}>
                <Text fw={600} size="md">{a.name}</Text>
                <Text size="xs" c="dimmed">
                  {a.ageGroup ?? "Age group —"} · updated {fmtDate(a.updatedAt.slice(0, 10))}
                </Text>
                <Group gap={4}>
                  {chips.length === 0 ? (
                    <Text size="xs" c="dimmed">No assessment data yet</Text>
                  ) : (
                    chips.map(([k, label]) => (
                      <Badge key={k} size="xs" variant="light" color="gray">{label}</Badge>
                    ))
                  )}
                </Group>
              </div>
            </Link>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}

export function AthletePicker() {
  return (
    <Suspense fallback={<Loader />}>
      <AthletePickerInner />
    </Suspense>
  );
}
