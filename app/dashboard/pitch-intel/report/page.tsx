import { Box, Button, Group, Text } from "@mantine/core";

/**
 * Ryan Chasse's Pitch Intelligence dashboard, embedded unchanged
 * (public/pitch-intel-app/athletes.html) and fed from pitch_intel.* through
 * /api/dashboard/pitch-intel/legacy. ?athlete=<athlete_uuid> opens that
 * athlete's profile directly.
 */
export default async function PitchIntelReportPage({ searchParams }: { searchParams: Promise<{ athlete?: string }> }) {
  const { athlete } = await searchParams;
  const athleteId = athlete && /^[A-Za-z0-9-]{1,64}$/.test(athlete) ? athlete : null;
  const src = `/pitch-intel-app/athletes.html${athleteId ? `?athlete=${encodeURIComponent(athleteId)}` : ""}`;

  return (
    <Box px="md" pt="xs">
      <Group justify="space-between" mb={6}>
        <Text size="sm" c="dimmed">
          Pitch Intelligence dashboard · Baseball Savant data, updated nightly
        </Text>
        <Group gap="xs">
          <Button component="a" href={src} target="_blank" rel="noreferrer" size="compact-sm" variant="subtle">
            Open full screen
          </Button>
          <Button component="a" href="/dashboard/pitch-intel" size="compact-sm" variant="default">
            Linked athletes
          </Button>
        </Group>
      </Group>
      <iframe
        key={src}
        src={src}
        title="Pitch Intelligence dashboard"
        style={{ width: "100%", height: "calc(100vh - 130px)", border: 0, borderRadius: 8, background: "#0b0d12" }}
      />
    </Box>
  );
}
