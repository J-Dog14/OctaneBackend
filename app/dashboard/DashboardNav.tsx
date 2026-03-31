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
  { href: "/dashboard/reports", label: "PDF Reports", adminOnly: true },
  { href: "/dashboard/settings", label: "Settings", adminOnly: true },
] as const;

export function DashboardNav() {
  const pathname = usePathname();
  const { user, isLoaded } = useUser();

  const clerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const isAdmin = !clerkConfigured || !isLoaded || user?.publicMetadata?.role === "admin";

  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  const activeHref =
    visibleTabs.find(
      (t) => t.href !== "/dashboard" && pathname.startsWith(t.href)
    )?.href ?? "/dashboard";

  return (
    <>
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
      {clerkConfigured && <UserButton />}
    </>
  );
}
