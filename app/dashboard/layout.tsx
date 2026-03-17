import Link from "next/link";
import { AppShell, AppShellHeader, AppShellMain, Group } from "@mantine/core";
import { DashboardNav } from "./DashboardNav";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell header={{ height: 56 }} padding="lg">
      <AppShellHeader>
        <Group h="100%" px="md" gap="xl" wrap="nowrap" justify="space-between">
          <Link
            href="/dashboard"
            style={{
              color: "var(--text-primary)",
              textDecoration: "none",
              fontWeight: 700,
              fontSize: "1.1rem",
              whiteSpace: "nowrap",
            }}
          >
            Octane Biomech
          </Link>
          <DashboardNav />
        </Group>
      </AppShellHeader>
      <AppShellMain>{children}</AppShellMain>
    </AppShell>
  );
}
