"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTab } from "@mantine/core";
import { useUser, UserButton } from "@clerk/nextjs";

const TABS = [
  { href: "/dashboard", label: "Dashboard", adminOnly: false },
  { href: "/dashboard/athletes", label: "Athletes", adminOnly: false },
  { href: "/dashboard/athlete-tracking", label: "Athlete Tracking", adminOnly: false },
  { href: "/dashboard/research", label: "Research", adminOnly: false },
  { href: "/dashboard/send-payload", label: "Send Payload", adminOnly: true },
  { href: "/dashboard/uais-maintenance", label: "UAIS Maintenance", adminOnly: true },
  { href: "/dashboard/readiness-screen", label: "Readiness Screen", adminOnly: true },
  { href: "/dashboard/reports", label: "PDF Reports", adminOnly: true },
  { href: "/dashboard/settings", label: "Settings", adminOnly: true },
  { href: "/dashboard/audit", label: "DB Audit", adminOnly: true },
] as const;

const clerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

function NavTabs({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);
  const activeHref =
    visibleTabs.find(
      (t) => t.href !== "/dashboard" && pathname.startsWith(t.href)
    )?.href ?? "/dashboard";

  return (
    <Tabs value={activeHref} variant="underline" keepMounted={false} style={{ flex: 1 }}>
      <TabsList style={{ borderBottom: "none", gap: 0 }}>
        {visibleTabs.map((tab) => (
          <TabsTab
            key={tab.href}
            value={tab.href}
            renderRoot={(props) => <Link {...props} href={tab.href} />}
            style={{ fontSize: "14px" }}
          >
            {tab.label}
          </TabsTab>
        ))}
      </TabsList>
    </Tabs>
  );
}

function DashboardNavWithClerk() {
  const { user, isLoaded } = useUser();
  const isAdmin = !isLoaded || user?.publicMetadata?.role === "admin";
  return (
    <>
      <NavTabs isAdmin={isAdmin} />
      <UserButton />
    </>
  );
}

export function DashboardNav() {
  if (clerkConfigured) {
    return <DashboardNavWithClerk />;
  }
  return <NavTabs isAdmin={true} />;
}
