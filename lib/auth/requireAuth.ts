import { auth, currentUser } from "@clerk/nextjs/server";
import { unauthorized, forbidden } from "@/lib/responses";

/**
 * Throws a 401 response if no Clerk session exists.
 * No-op when CLERK_SECRET_KEY is not configured.
 * Call BEFORE any try/catch block in /api/dashboard/* handlers.
 */
export async function requireAuth(): Promise<void> {
  if (!process.env.CLERK_SECRET_KEY) return;
  const { userId } = await auth();
  if (!userId) {
    throw unauthorized("Authentication required");
  }
}

/**
 * Throws a 401 if not authenticated, 403 if authenticated but wrong role.
 * No-op when CLERK_SECRET_KEY is not configured.
 * Call BEFORE any try/catch block in /api/dashboard/* handlers.
 */
export async function requireRole(role: string): Promise<void> {
  if (!process.env.CLERK_SECRET_KEY) return;
  const { userId } = await auth();
  if (!userId) {
    throw unauthorized("Authentication required");
  }
  const user = await currentUser();
  const userRole = (user?.publicMetadata?.role as string) ?? "user";
  if (userRole !== role) {
    throw forbidden("Insufficient permissions");
  }
}

/** Roles that can open the coach suite (/coach, /api/coach/*). */
export const COACH_SUITE_ROLES = ["coach", "admin"] as const;

/**
 * Returns a 401/403 response when the caller is not signed in or has none of
 * `roles`, otherwise null. Unlike requireRole it returns instead of throwing,
 * so handlers can `const denied = await checkRoles([...]); if (denied) return denied;`
 * and the client gets a real 401/403. No-op when CLERK_SECRET_KEY is not configured.
 */
export async function checkRoles(roles: readonly string[]) {
  if (!process.env.CLERK_SECRET_KEY) return null;
  const { userId } = await auth();
  if (!userId) return unauthorized("Authentication required");
  const user = await currentUser();
  const userRole = (user?.publicMetadata?.role as string) ?? "user";
  return roles.includes(userRole) ? null : forbidden("Insufficient permissions");
}

/**
 * 403 for the given roles (signed-in users with any other role pass). Used on
 * staff write routes that are open to every signed-in user, so coach accounts
 * stay read-only. Returns null when allowed.
 */
export async function denyRoles(roles: readonly string[]) {
  if (!process.env.CLERK_SECRET_KEY) return null;
  const { userId } = await auth();
  if (!userId) return unauthorized("Authentication required");
  const user = await currentUser();
  const userRole = (user?.publicMetadata?.role as string) ?? "user";
  return roles.includes(userRole) ? forbidden("Coach accounts are read-only") : null;
}
