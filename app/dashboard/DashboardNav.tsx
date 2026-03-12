"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/athletes", label: "Athletes" },
  { href: "/dashboard/athlete-tracking", label: "Athlete Tracking" },
  { href: "/dashboard/send-payload", label: "Send Payload" },
  { href: "/dashboard/uais-maintenance", label: "UAIS Maintenance" },
  { href: "/dashboard/settings", label: "Settings" },
] as const;

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
      {TABS.map((tab) => {
        const isActive = pathname === tab.href || (tab.href !== "/dashboard" && pathname.startsWith(tab.href));
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              color: isActive ? "var(--accent)" : "var(--text-secondary)",
              textDecoration: "none",
              padding: "0.5rem 0.75rem",
              borderRadius: "6px",
              fontWeight: isActive ? 600 : 400,
              borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
