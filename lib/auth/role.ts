import { currentUser } from "@clerk/nextjs/server";

/** Roles stored in Clerk publicMetadata.role. Missing means "user" (staff). */
export const ROLES = ["user", "coach", "admin"] as const;
export type Role = (typeof ROLES)[number];

/**
 * The signed-in user's role for server components, or null when Clerk isn't
 * configured or nobody is signed in.
 */
export async function getRole(): Promise<Role | null> {
  if (!process.env.CLERK_SECRET_KEY) return null;
  const user = await currentUser();
  if (!user) return null;
  const role = user.publicMetadata?.role;
  return ROLES.includes(role as Role) ? (role as Role) : "user";
}

/** Where a role lands when it opens the app root. */
export function homeFor(role: Role | null): string {
  return role === "coach" ? "/coach" : "/dashboard";
}
