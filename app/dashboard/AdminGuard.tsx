"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Wraps admin-only pages. Redirects to /dashboard if the signed-in user
 * does not have role "admin" in their Clerk publicMetadata.
 * No-op when Clerk is not configured (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY not set).
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const clerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  useEffect(() => {
    if (clerkConfigured && isLoaded && user?.publicMetadata?.role !== "admin") {
      router.replace("/dashboard");
    }
  }, [clerkConfigured, isLoaded, user, router]);

  if (clerkConfigured && isLoaded && user?.publicMetadata?.role !== "admin") {
    return null;
  }

  return <>{children}</>;
}
