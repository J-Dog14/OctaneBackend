"use client";

import Link from "next/link";
import { UserButton, useUser } from "@clerk/nextjs";
import { Button, Center, Group, Stack, Text, Title } from "@mantine/core";
import { CoachDataProvider } from "./_components/CoachDataProvider";

const clerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const ALLOWED = new Set(["coach", "admin"]);

function Guard({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();
  const role = user?.publicMetadata?.role as string | undefined;
  const allowed = !!role && ALLOWED.has(role);

  if (!isLoaded) return null;
  if (!user) return <NoAccess message="You're signed out." />;
  if (!allowed) {
    const email = user.primaryEmailAddress?.emailAddress ?? "This account";
    return (
      <NoAccess
        message={`${email} has role "${role ?? "user"}", which can't open the coach view. An admin can change it on the Users page.`}
      />
    );
  }
  return <CoachDataProvider key={user.id}>{children}</CoachDataProvider>;
}

/** Shown instead of silently redirecting, so a wrong Clerk role is obvious. */
function NoAccess({ message }: { message: string }) {
  return (
    <Center h="100vh" p="md">
      <Stack align="center" gap="sm" maw={460}>
        <Title order={3}>No coach access</Title>
        <Text c="dimmed" ta="center">{message}</Text>
        <Group>
          <Button component={Link} href="/dashboard" variant="light">Back to dashboard</Button>
          <UserButton />
        </Group>
      </Stack>
    </Center>
  );
}

/**
 * Coach suite pages: Clerk role "coach" or "admin". The /api/coach routes
 * check the same roles server-side; this only keeps the UI tidy.
 * No-op when Clerk is not configured (local dev).
 */
export function CoachGuard({ children }: { children: React.ReactNode }) {
  return clerkConfigured ? <Guard>{children}</Guard> : <CoachDataProvider>{children}</CoachDataProvider>;
}

function useIsAdminClerk(): boolean {
  const { user, isLoaded } = useUser();
  return isLoaded && user?.publicMetadata?.role === "admin";
}

/** True for admins (always true when Clerk isn't configured). */
export const useIsAdmin: () => boolean = clerkConfigured ? useIsAdminClerk : () => true;
