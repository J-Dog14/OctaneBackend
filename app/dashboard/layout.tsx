
import Link from "next/link";
import { AppShell, AppShellHeader, AppShellMain, Group } from "@mantine/core";
import { redirect } from "next/navigation";
import { getRole } from "@/lib/auth/role";
import { DashboardNav } from "./DashboardNav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Coach accounts only get the coach suite; send them there before anything renders.
  if ((await getRole()) === "coach") redirect("/coach");

  return (
    <AppShell header={{ height: 56 }} padding="lg">
      <AppShellHeader style={{ borderBottom: "1px solid var(--border)" }}>
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
