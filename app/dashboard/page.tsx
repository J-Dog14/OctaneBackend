export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card, Text, Title, SimpleGrid, Group, Stack } from "@mantine/core";
import { getRecentAthletes } from "@/lib/dashboard/athletes";
import { RecentAthletesGrid } from "./RecentAthletesGrid";

export default async function DashboardPage() {
  const recentAthletes = await getRecentAthletes(20);

  return (
    <Stack gap="xl">
      <div>
        <Title order={1} mb={4}>Dashboard</Title>
        <Text c="dimmed">
          Overview and quick actions for athletes and payloads.
        </Text>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
        <Link href="/dashboard/athletes" style={{ textDecoration: "none", color: "inherit" }}>
          <Card style={{ height: "100%", cursor: "pointer" }}>
            <Text size="xs" c="dimmed" mb={4} tt="uppercase" fw={600} style={{ letterSpacing: "0.04em" }}>
              Athletes
            </Text>
            <Text size="xl" fw={700} c="var(--accent)">Browse all</Text>
            <Text size="sm" c="dimmed" mt="xs">
              Search and view athlete data and session counts.
            </Text>
          </Card>
        </Link>

        <Link href="/dashboard/athlete-tracking" style={{ textDecoration: "none", color: "inherit" }}>
          <Card style={{ height: "100%", cursor: "pointer" }}>
            <Text size="xs" c="dimmed" mb={4} tt="uppercase" fw={600} style={{ letterSpacing: "0.04em" }}>
              Athlete Tracking
            </Text>
            <Text size="xl" fw={700} c="var(--accent)">Track & Compare</Text>
            <Text size="sm" c="dimmed" mt="xs">
              Deep-dive metrics, percentile radar charts, and session comparisons.
            </Text>
          </Card>
        </Link>

        <Link href="/dashboard/reports" style={{ textDecoration: "none", color: "inherit" }}>
          <Card style={{ height: "100%", cursor: "pointer" }}>
            <Text size="xs" c="dimmed" mb={4} tt="uppercase" fw={600} style={{ letterSpacing: "0.04em" }}>
              Reports
            </Text>
            <Text size="xl" fw={700} c="var(--accent)">PDF Reports</Text>
            <Text size="sm" c="dimmed" mt="xs">
              Generate and download PDF reports for athletes.
            </Text>
          </Card>
        </Link>
      </SimpleGrid>

      <Card>
        <Title order={2} fz="lg" mb="md">
          Recently modified athletes
        </Title>
        {recentAthletes.length === 0 ? (
          <Text c="dimmed">No athletes in the database yet.</Text>
        ) : (
          <RecentAthletesGrid athletes={recentAthletes} />
        )}
        <Group mt="md">
          <Link href="/dashboard/athletes" className="btn-primary" style={{ display: "inline-block" }}>
            View all athletes
          </Link>
        </Group>
      </Card>
    </Stack>
  );
}
