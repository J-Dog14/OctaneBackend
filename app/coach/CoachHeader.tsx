"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import { Badge, Group } from "@mantine/core";
import { UserButton } from "@clerk/nextjs";
import type { CoachAthleteSummary } from "@/lib/coach/summary";
import { useIsAdmin } from "./CoachGuard";
import { AthleteSearchSelect } from "./_components/AthleteSearchSelect";
import { SyncDatabaseButton } from "./_components/SyncDatabaseButton";
import { summaryKey, swrOpts } from "./_components/fetcher";

const clerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/** Brand, an always-there athlete switcher, and the account menu. */
export function CoachHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const current = pathname.match(/^\/coach\/athletes\/([A-Za-z0-9-]{1,64})/)?.[1] ?? null;
  const { data } = useSWR<CoachAthleteSummary>(current ? summaryKey(current) : null, swrOpts);

  return (
    <Group h="100%" px="md" gap="lg" wrap="nowrap" justify="space-between">
      <Group gap="lg" wrap="nowrap" style={{ minWidth: 0 }}>
        <Link href="/coach?browse=1" style={{ color: "var(--text-primary)", textDecoration: "none", fontWeight: 700, fontSize: "1.1rem", whiteSpace: "nowrap" }}>
          8ctane <span style={{ color: "var(--accent)" }}>Coach</span>
        </Link>
        <AthleteSearchSelect
          // Remount per athlete so the box shows the new name, not the old search text.
          key={`${current ?? "none"}:${data ? 1 : 0}`}
          value={data ? current : null}
          valueLabel={data?.athlete.name ?? null}
          placeholder="Switch athlete…"
          w={280}
          onChange={(v) => v && v !== current && router.push(`/coach/athletes/${v}`)}
        />
        <Link href="/coach?browse=1" style={{ fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
          All athletes
        </Link>
      </Group>
      <Group gap="sm" wrap="nowrap">
        <SyncDatabaseButton />
        {isAdmin && (
          <Link href="/dashboard" style={{ textDecoration: "none" }}>
            <Badge variant="light" color="gray" style={{ cursor: "pointer" }}>
              Backend
            </Badge>
          </Link>
        )}
        {clerkConfigured && <UserButton />}
      </Group>
    </Group>
  );
}
