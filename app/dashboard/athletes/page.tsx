export const dynamic = "force-dynamic";

import { Title, Text, Card } from "@mantine/core";
import { AthletesGrid } from "./AthletesGrid";

export default async function AthletesPage() {
  return (
    <div>
      <Title order={1} mb={4}>Athletes</Title>
      <Text c="dimmed" mb="lg">
        Browse athletes and session counts per table.
      </Text>
      <Card p="md">
        <AthletesGrid />
      </Card>
    </div>
  );
}
