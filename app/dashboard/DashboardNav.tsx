"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTab } from "@mantine/core";
import { UserButton } from "@clerk/nextjs";

const TABS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/athletes", label: "Athletes" },
  { href: "/dashboard/athlete-tracking", label: "Athlete Tracking" },
  { href: "/dashboard/send-payload", label: "Send Payload" },
  { href: "/dashboard/uais-maintenance", label: "UAIS Maintenance" },
  { href: "/dashboard/reports", label: "PDF Reports" },
  { href: "/dashboard/settings", label: "Settings" },
] as const;

export function DashboardNav() {
  const pathname = usePathname();

  const activeHref =
    TABS.find(
      (t) => t.href !== "/dashboard" && pathname.startsWith(t.href)
    )?.href ?? "/dashboard";

  return (
    <>
      <Tabs value={activeHref} variant="underline" keepMounted={false} style={{ flex: 1 }}>
        <TabsList style={{ borderBottom: "none", gap: 0 }}>
          {TABS.map((tab) => (
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
      {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && <UserButton />}
    </>
  );
}
