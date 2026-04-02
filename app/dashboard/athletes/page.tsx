import dynamic from "next/dynamic";
import { Title, Text, Card } from "@mantine/core";

const AthletesGrid = dynamic(
  () => import("./AthletesGrid").then((m) => ({ default: m.AthletesGrid })),
  { loading: () => <div style={{ height: "calc(100vh - 300px)", minHeight: 400 }} /> }
);

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
