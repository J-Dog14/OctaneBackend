"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CoachDataProvider } from "./_components/CoachDataProvider";

const clerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const ALLOWED = new Set(["coach", "admin"]);

function Guard({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const role = user?.publicMetadata?.role as string | undefined;
  const allowed = !!role && ALLOWED.has(role);

  useEffect(() => {
    if (isLoaded && !allowed) router.replace("/dashboard");
  }, [isLoaded, allowed, router]);

  if (!isLoaded || !allowed) return null;
  return <CoachDataProvider key={user!.id}>{children}</CoachDataProvider>;
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
